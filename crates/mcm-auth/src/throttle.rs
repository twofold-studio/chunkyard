use crate::AuthError;
use std::{collections::HashMap, net::IpAddr};
const CAPACITY: usize = 100_000;
#[derive(Default)]
pub(crate) struct Throttle {
    ips: HashMap<IpAddr, Attempts>,
    pairs: HashMap<(IpAddr, String), Attempts>,
}
#[derive(Default)]
struct Attempts {
    failures: u32,
    since: i64,
    blocked_until: i64,
}
impl Throttle {
    pub fn check(&mut self, ip: IpAddr, email: &str, now: i64) -> Result<(), AuthError> {
        if self.ips.len() + self.pairs.len() >= CAPACITY {
            self.ips.retain(|_, a| now - a.since < 600);
            self.pairs.retain(|_, a| now - a.since < 600);
            if self.ips.len() + self.pairs.len() >= CAPACITY {
                return Err(AuthError::Throttled);
            }
        }
        if self
            .ips
            .get(&ip)
            .is_some_and(|a| now - a.since < 600 && a.failures >= 30)
            || self
                .pairs
                .get(&(ip, email.to_owned()))
                .is_some_and(|a| now < a.blocked_until)
        {
            return Err(AuthError::Throttled);
        }
        Ok(())
    }
    pub fn failure(&mut self, ip: IpAddr, email: &str, now: i64) {
        let ip_attempts = self.ips.entry(ip).or_default();
        if now - ip_attempts.since >= 600 {
            *ip_attempts = Attempts {
                since: now,
                ..Default::default()
            };
        }
        ip_attempts.failures += 1;
        let pair = self.pairs.entry((ip, email.to_owned())).or_default();
        if now - pair.since >= 600 {
            *pair = Attempts {
                since: now,
                ..Default::default()
            };
        }
        pair.failures += 1;
        if pair.failures >= 5 {
            pair.blocked_until = now + (1_i64 << (pair.failures - 5).min(9)).min(300);
        }
    }
    pub fn success(&mut self, ip: IpAddr, email: &str) {
        self.pairs.remove(&(ip, email.to_owned()));
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn an_attacker_cannot_lock_out_other_ips() -> Result<(), Box<dyn std::error::Error>> {
        let mut throttle = Throttle::default();
        let attacker = "10.0.0.1".parse()?;
        for _ in 0..5 {
            throttle.failure(attacker, "owner", 1000);
        }
        assert!(throttle.check(attacker, "owner", 1000).is_err());
        assert!(throttle.check("10.0.0.2".parse()?, "owner", 1000).is_ok());
        assert!(throttle.check(attacker, "owner", 1001).is_ok());
        Ok(())
    }
}
