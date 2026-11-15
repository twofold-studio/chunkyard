use super::{DockerRuntime, docker_error};
use bollard::{models::ContainerStatsResponse, query_parameters::StatsOptionsBuilder};
use futures_util::StreamExt;
use mcm_core::server::{Server, ServerError, ServerMetrics, ServerState};
use std::time::Duration;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

impl DockerRuntime {
    pub(super) async fn follow_metrics(
        &self,
        server: &Server,
    ) -> Result<mcm_core::server::MetricsStream, ServerError> {
        let container = self.inspect(server).await?;
        let started_at = container
            .as_ref()
            .and_then(|c| c.state.as_ref())
            .and_then(|s| s.started_at.clone());
        let status = Self::status_of(container);
        if status.state != ServerState::Running {
            return Err(ServerError::NotRunning);
        }
        let id = status.container_id.clone().ok_or(ServerError::Docker)?;
        let server_id = server.id.clone();
        let stream = self.ready().await?.stats(
            &id,
            Some(StatsOptionsBuilder::default().stream(true).build()),
        );
        // A single Docker stream supplies native samples. No repeated inspect/stats
        // requests and no fabricated 100 ms timestamps over Docker's slower cadence.
        Ok(Box::pin(stream.map(move |stats| {
            let stats = stats.map_err(docker_error)?;
            let now = OffsetDateTime::now_utc();
            let mut result = ServerMetrics {
                server_id: server_id.clone(),
                status: status.clone(),
                sampled_at: stats
                    .read
                    .clone()
                    .unwrap_or_else(|| now.format(&Rfc3339).unwrap_or_default()),
                started_at: started_at.clone(),
                uptime_seconds: started_at
                    .as_deref()
                    .and_then(|s| OffsetDateTime::parse(s, &Rfc3339).ok())
                    .and_then(|s| u64::try_from((now - s).whole_seconds()).ok()),
                cpu_percent: None,
                memory_usage_bytes: None,
                memory_working_set_bytes: None,
                memory_limit_bytes: None,
                network_rx_bytes: None,
                network_tx_bytes: None,
                block_read_bytes: None,
                block_write_bytes: None,
                pids: None,
            };
            apply_stats(&mut result, &stats);
            Ok(result)
        })))
    }
    pub(super) async fn sample_metrics(
        &self,
        server: &Server,
    ) -> Result<ServerMetrics, ServerError> {
        let _permit = self
            .stats_slots
            .try_acquire()
            .map_err(|_| ServerError::MetricsBusy)?;
        let container = self.inspect(server).await?;
        let started_at = container
            .as_ref()
            .and_then(|c| c.state.as_ref())
            .and_then(|s| s.started_at.clone());
        let status = Self::status_of(container);
        let mut result = ServerMetrics {
            server_id: server.id.clone(),
            status,
            sampled_at: OffsetDateTime::now_utc()
                .format(&Rfc3339)
                .map_err(|_| ServerError::Docker)?,
            started_at,
            uptime_seconds: None,
            cpu_percent: None,
            memory_usage_bytes: None,
            memory_working_set_bytes: None,
            memory_limit_bytes: None,
            network_rx_bytes: None,
            network_tx_bytes: None,
            block_read_bytes: None,
            block_write_bytes: None,
            pids: None,
        };
        if result.status.state != ServerState::Running {
            return Ok(result);
        }
        let id = result
            .status
            .container_id
            .as_deref()
            .ok_or(ServerError::Docker)?;
        // Address the verified immutable container ID, so replacing a container
        // with the same name cannot redirect a sample to a foreign container.
        let mut stream = self.ready().await?.stats(
            id,
            Some(
                StatsOptionsBuilder::default()
                    .stream(false)
                    .one_shot(false)
                    .build(),
            ),
        );
        let stats = tokio::time::timeout(Duration::from_secs(5), stream.next())
            .await
            .map_err(|_| ServerError::DockerUnavailable)?
            .ok_or(ServerError::Docker)?
            .map_err(docker_error)?;
        apply_stats(&mut result, &stats);
        let now = OffsetDateTime::now_utc();
        result.sampled_at = now.format(&Rfc3339).map_err(|_| ServerError::Docker)?;
        result.uptime_seconds = result
            .started_at
            .as_deref()
            .and_then(|s| OffsetDateTime::parse(s, &Rfc3339).ok())
            .and_then(|started| u64::try_from((now - started).whole_seconds()).ok());
        Ok(result)
    }
}

fn apply_stats(result: &mut ServerMetrics, stats: &ContainerStatsResponse) {
    result.cpu_percent = cpu_percent(stats);
    if let Some(memory) = &stats.memory_stats {
        result.memory_usage_bytes = memory.usage;
        result.memory_limit_bytes = memory.limit;
        // Docker CLI semantics: cgroup v1 uses total_inactive_file; v2 uses
        // inactive_file. Do not mistake total filesystem cache for JVM heap.
        result.memory_working_set_bytes = working_set(memory);
    }
    if let Some(networks) = &stats.networks {
        result.network_rx_bytes = sum_known(networks.values().map(|n| n.rx_bytes));
        result.network_tx_bytes = sum_known(networks.values().map(|n| n.tx_bytes));
    }
    if let Some(entries) = stats
        .blkio_stats
        .as_ref()
        .and_then(|s| s.io_service_bytes_recursive.as_ref())
    {
        result.block_read_bytes = sum_known(
            entries
                .iter()
                .filter(|e| {
                    e.op.as_deref()
                        .is_some_and(|s| s.eq_ignore_ascii_case("read"))
                })
                .map(|e| e.value),
        );
        result.block_write_bytes = sum_known(
            entries
                .iter()
                .filter(|e| {
                    e.op.as_deref()
                        .is_some_and(|s| s.eq_ignore_ascii_case("write"))
                })
                .map(|e| e.value),
        );
    }
    result.pids = stats.pids_stats.as_ref().and_then(|s| s.current);
}
fn working_set(memory: &bollard::models::ContainerMemoryStats) -> Option<u64> {
    let stats = memory.stats.as_ref()?;
    let inactive = stats
        .get("total_inactive_file")
        .or_else(|| stats.get("inactive_file"))?;
    let usage = memory.usage?;
    // Counter races must not turn positive usage into a false zero.
    Some(usage.checked_sub(*inactive).unwrap_or(usage))
}
fn sum_known(mut values: impl Iterator<Item = Option<u64>>) -> Option<u64> {
    values.try_fold(0_u64, |sum, value| sum.checked_add(value?))
}
fn cpu_percent(stats: &ContainerStatsResponse) -> Option<f64> {
    let current = stats.cpu_stats.as_ref()?;
    let previous = stats.precpu_stats.as_ref()?;
    let usage = current.cpu_usage.as_ref()?;
    let delta = usage
        .total_usage?
        .checked_sub(previous.cpu_usage.as_ref()?.total_usage?)?;
    let system_delta = current
        .system_cpu_usage?
        .checked_sub(previous.system_cpu_usage?)?;
    let cpus = current
        .online_cpus
        .map(u64::from)
        .or_else(|| usage.percpu_usage.as_ref().map(|v| v.len() as u64))?;
    if system_delta == 0 || cpus == 0 {
        return None;
    }
    Some(delta as f64 / system_delta as f64 * cpus as f64 * 100.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
    #[test]
    fn cpu_is_relative_to_one_core_and_missing_or_reset_counters_are_unknown() -> Result {
        let mut stats: ContainerStatsResponse = serde_json::from_value(
            json!({"cpu_stats":{"cpu_usage":{"total_usage":400},"system_cpu_usage":1000,"online_cpus":8},"precpu_stats":{"cpu_usage":{"total_usage":100},"system_cpu_usage":200}}),
        )?;
        assert_eq!(cpu_percent(&stats), Some(300.0));
        stats
            .precpu_stats
            .as_mut()
            .ok_or("missing previous")?
            .system_cpu_usage = Some(1000);
        assert_eq!(cpu_percent(&stats), None);
        stats.precpu_stats = None;
        assert_eq!(cpu_percent(&stats), None);
        Ok(())
    }
    #[test]
    fn working_set_handles_both_cgroup_versions_and_missing_or_inconsistent_cache() -> Result {
        for (values, expected) in [
            (
                json!({"usage":1000,"stats":{"total_inactive_file":250}}),
                Some(750),
            ),
            (
                json!({"usage":1000,"stats":{"inactive_file":100}}),
                Some(900),
            ),
            (
                json!({"usage":1000,"stats":{"inactive_file":2000}}),
                Some(1000),
            ),
            (json!({"usage":1000}), None),
        ] {
            let memory = serde_json::from_value(values)?;
            assert_eq!(working_set(&memory), expected);
        }
        Ok(())
    }
    #[test]
    fn cumulative_counters_do_not_hide_partial_values_or_overflow() {
        assert_eq!(sum_known([Some(10), Some(20)].into_iter()), Some(30));
        assert_eq!(sum_known([Some(10), None].into_iter()), None);
        assert_eq!(sum_known([Some(u64::MAX), Some(1)].into_iter()), None);
    }
}
