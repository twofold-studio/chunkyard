use crate::dto::*;
use crate::{AppState, error::ApiError};
use axum::{
    Json,
    extract::{Path, Query, State},
};

#[utoipa::path(get, path = "/api/v1/modpacks/curseforge/{id}", operation_id = "software_modpack", tag = "software", params(("id" = u64, Path)), responses((status = 400, description = "Axum path or query rejection", body = String, content_type = "text/plain"), (status = 200, description = "Success", body = CurseForgeModpack), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn modpack(
    State(s): State<AppState>,
    Path(id): Path<u64>,
) -> Result<Json<CurseForgeModpack>, ApiError> {
    Ok(Json(
        serde_json::from_value(s.software.modpack(id).await?).map_err(ApiError::internal)?,
    ))
}
#[utoipa::path(get, path = "/api/v1/modpacks/curseforge/{id}/logo", operation_id = "software_modpack_logo", tag = "software", params(("id" = u64, Path)), responses((status = 400, description = "Axum path or query rejection", body = String, content_type = "text/plain"), (status = 200, description = "Binary response", body = crate::dto::BinaryBody, content_type = "image/png"), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn modpack_logo(
    State(s): State<AppState>,
    Path(id): Path<u64>,
) -> Result<axum::response::Response, ApiError> {
    Ok(crate::icons::png(s.software.modpack_logo(id).await?))
}
#[derive(serde::Deserialize, Default, utoipa::ToSchema, utoipa::IntoParams)]
#[serde(default, deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub(crate) struct Search {
    query: String,
    index: u32,
}
#[utoipa::path(get, path = "/api/v1/modpacks/curseforge", operation_id = "software_modpacks", tag = "software", params(Search), responses((status = 400, description = "Axum path or query rejection", body = String, content_type = "text/plain"), (status = 200, description = "Success", body = CurseForgeSearch), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn modpacks(
    State(s): State<AppState>,
    Query(q): Query<Search>,
) -> Result<Json<CurseForgeSearch>, ApiError> {
    Ok(Json(
        serde_json::from_value(s.software.search_modpacks(&q.query, q.index).await?)
            .map_err(ApiError::internal)?,
    ))
}
#[utoipa::path(get, path = "/api/v1/modpacks/curseforge/{id}/files", operation_id = "software_modpack_files", tag = "software", params(("id" = u64, Path)), responses((status = 400, description = "Axum path or query rejection", body = String, content_type = "text/plain"), (status = 200, description = "Success", body = Items<CurseForgeFile>), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn modpack_files(
    State(s): State<AppState>,
    Path(id): Path<u64>,
) -> Result<Json<Items<CurseForgeFile>>, ApiError> {
    Ok(Json(
        serde_json::from_value(s.software.modpack_files(id).await?).map_err(ApiError::internal)?,
    ))
}
#[utoipa::path(get, path = "/api/v1/software", operation_id = "software_catalog", tag = "software", responses((status = 200, description = "Success", body = Items<SoftwareCatalogItem>), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn catalog(
    State(state): State<AppState>,
) -> Result<Json<Items<SoftwareCatalogItem>>, ApiError> {
    Ok(Json(
        serde_json::from_value(state.software.catalog()).map_err(ApiError::internal)?,
    ))
}
#[utoipa::path(get, path = "/api/v1/software/{kind}/versions", operation_id = "software_versions", tag = "software", params(("kind" = String, Path)), responses((status = 200, description = "Success", body = Items<SoftwareVersion>), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn versions(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<Json<Items<SoftwareVersion>>, ApiError> {
    Ok(Json(
        serde_json::from_value(state.software.versions(&kind).await?)
            .map_err(ApiError::internal)?,
    ))
}
#[utoipa::path(get, path = "/api/v1/software/{kind}/versions/{version}/builds", operation_id = "software_builds", tag = "software", params(("kind" = String, Path), ("version" = String, Path)), responses((status = 200, description = "Success", body = Items<SoftwareVersion>), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn builds(
    State(state): State<AppState>,
    Path((kind, version)): Path<(String, String)>,
) -> Result<Json<Items<SoftwareVersion>>, ApiError> {
    Ok(Json(
        serde_json::from_value(state.software.builds(&kind, &version).await?)
            .map_err(ApiError::internal)?,
    ))
}
