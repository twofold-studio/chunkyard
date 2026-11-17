fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!(
        "{}",
        serde_json::to_string_pretty(&chunkyard_api::openapi::generate()?)?
    );
    Ok(())
}
