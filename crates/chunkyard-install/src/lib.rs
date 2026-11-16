//! Official server catalogs and bounded, checksum-verified software preparation.
mod catalogs;
mod client;
mod curseforge;
mod modded;
mod pack;
mod providers;
mod purpur;
pub use client::Installers;
