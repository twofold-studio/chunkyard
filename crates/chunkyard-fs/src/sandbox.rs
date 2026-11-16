//! File access through directory capabilities; user paths never become ambient paths.
//! Access, writes, copies and exports share the same validated capability operations.
mod access;
mod atomic;
mod copying;
mod exports;

use cap_std::fs::Dir;

const ENTRY_LIMIT: usize = 5000;

pub struct Sandbox {
    root: Dir,
}
