//! Métricas de rendimiento del proceso (CPU, RAM, disco, GPU).

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

static PERFORMANCE_SYSTEM: OnceLock<Mutex<sysinfo::System>> = OnceLock::new();
