//! Monitor de rendimiento: CPU, memoria y GPU por proceso.

use super::*;

pub static PERFORMANCE_SYSTEM: OnceLock<Mutex<sysinfo::System>> = OnceLock::new();

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceProcess {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub disk_read_bytes: u64,
    pub disk_write_bytes: u64,
    pub gpu_percent: Option<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceMetrics {
    pub processes: Vec<PerformanceProcess>,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub disk_read_bytes: u64,
    pub disk_write_bytes: u64,
    pub gpu_percent: Option<f32>,
}

/// Consulta PDH de GPU persistente: evita abrir/cerrar + sleep(120ms) en cada poll.
#[cfg(windows)]
pub struct GpuPdhState {
    pub query: windows::Win32::System::Performance::PDH_HQUERY,
    pub counter: windows::Win32::System::Performance::PDH_HCOUNTER,
    /// Tras el primer Collect, los siguientes ya tienen deltas válidos.
    pub primed: bool,
}

// PDH_HQUERY / PDH_HCOUNTER son *mut c_void; el acceso queda serializado por Mutex.
#[cfg(windows)]
unsafe impl Send for GpuPdhState {}
#[cfg(windows)]
unsafe impl Sync for GpuPdhState {}

#[cfg(windows)]
pub static GPU_PDH: OnceLock<Mutex<Option<GpuPdhState>>> = OnceLock::new();

#[cfg(windows)]
pub fn query_gpu_usage(process_ids: &HashSet<u32>) -> Option<HashMap<u32, f32>> {
    use windows::{
        core::PCWSTR,
        Win32::System::Performance::{
            PdhAddEnglishCounterW, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
            PdhOpenQueryW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
            PDH_MORE_DATA,
        },
    };

    let slot = GPU_PDH.get_or_init(|| Mutex::new(None));
    let mut guard = slot.lock().ok()?;

    unsafe {
        if guard.is_none() {
            let mut query = PDH_HQUERY::default();
            if PdhOpenQueryW(PCWSTR::null(), 0, &mut query) != 0 {
                return None;
            }
            let counter_path: Vec<u16> = "\\GPU Engine(*)\\Utilization Percentage"
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let mut counter = PDH_HCOUNTER::default();
            if PdhAddEnglishCounterW(query, PCWSTR(counter_path.as_ptr()), 0, &mut counter) != 0 {
                return None;
            }
            let _ = PdhCollectQueryData(query);
            *guard = Some(GpuPdhState {
                query,
                counter,
                primed: false,
            });
            return None;
        }

        let state = guard.as_mut()?;
        if PdhCollectQueryData(state.query) != 0 {
            return None;
        }
        if !state.primed {
            state.primed = true;
            return None;
        }

        let counter = state.counter;
        let mut buffer_size = 0_u32;
        let mut item_count = 0_u32;
        let status = PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_DOUBLE,
            &mut buffer_size,
            &mut item_count,
            None,
        );
        if status != PDH_MORE_DATA || buffer_size == 0 || item_count == 0 {
            return None;
        }

        let mut buffer = vec![0_u64; (buffer_size as usize).div_ceil(std::mem::size_of::<u64>())];
        let items = buffer.as_mut_ptr().cast::<PDH_FMT_COUNTERVALUE_ITEM_W>();
        if PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_DOUBLE,
            &mut buffer_size,
            &mut item_count,
            Some(items),
        ) != 0
        {
            return None;
        }

        let mut usage_by_process: HashMap<u32, f32> = HashMap::new();
        for item in std::slice::from_raw_parts(items, item_count as usize) {
            if item.FmtValue.CStatus != 0 || item.szName.0.is_null() {
                continue;
            }
            let mut length = 0;
            while *item.szName.0.add(length) != 0 {
                length += 1;
            }
            let instance =
                String::from_utf16_lossy(std::slice::from_raw_parts(item.szName.0, length));
            let Some(pid_start) = instance.find("pid_") else {
                continue;
            };
            let pid_text = instance[pid_start + 4..]
                .split('_')
                .next()
                .unwrap_or_default();
            let Ok(pid) = pid_text.parse::<u32>() else {
                continue;
            };
            if !process_ids.contains(&pid) {
                continue;
            }
            let usage = item.FmtValue.Anonymous.doubleValue;
            if usage.is_finite() && usage >= 0.0 {
                let entry = usage_by_process.entry(pid).or_insert(0.0_f32);
                *entry = (*entry).max(usage as f32);
            }
        }
        Some(usage_by_process)
    }
}

#[cfg(not(windows))]
pub fn query_gpu_usage(_process_ids: &HashSet<u32>) -> Option<HashMap<u32, f32>> {
    None
}

#[tauri::command]
pub async fn get_performance_metrics() -> Result<PerformanceMetrics, String> {
    tauri::async_runtime::spawn_blocking(collect_performance_metrics)
        .await
        .map_err(|error| format!("Falló el proceso de medición de rendimiento: {error}"))?
}

pub fn collect_performance_metrics() -> Result<PerformanceMetrics, String> {
    use sysinfo::{Pid, ProcessesToUpdate, System};

    let system = PERFORMANCE_SYSTEM.get_or_init(|| Mutex::new(System::new_all()));
    let (linked_pids, per_process_raw, cpu_cores) = {
        let mut system = system
            .lock()
            .map_err(|_| "No se pudo acceder al monitor de rendimiento.".to_string())?;
        system.refresh_cpu_all();
        system.refresh_processes(ProcessesToUpdate::All, true);

        let current_pid = Pid::from_u32(std::process::id());
        let mut linked_pids = HashSet::from([current_pid]);
        for _ in 0..8 {
            let before = linked_pids.len();
            for (pid, process) in system.processes() {
                if process
                    .parent()
                    .is_some_and(|parent| linked_pids.contains(&parent))
                {
                    linked_pids.insert(*pid);
                }
            }
            if before == linked_pids.len() {
                break;
            }
        }

        let host_names: HashSet<String> = linked_pids
            .iter()
            .filter_map(|pid| system.process(*pid))
            .map(|p| p.name().to_string_lossy().to_lowercase())
            .collect();
        for (pid, process) in system.processes() {
            if linked_pids.contains(pid) {
                continue;
            }
            let name = process.name().to_string_lossy().to_lowercase();
            let looks_webview = name.contains("msedgewebview2")
                || name.contains("webview2")
                || name.contains("resonance");
            if !looks_webview {
                continue;
            }
            if process
                .parent()
                .and_then(|parent| system.process(parent))
                .is_some_and(|parent| {
                    let pn = parent.name().to_string_lossy().to_lowercase();
                    host_names.iter().any(|h| pn.contains(h) || h.contains(&pn))
                        || pn.contains("resonance")
                        || pn.contains("webview")
                })
            {
                linked_pids.insert(*pid);
            }
        }

        let cpu_cores = system.cpus().len().max(1) as f32;
        let mut per_process_raw: Vec<(u32, String, f32, u64, u64, u64)> = Vec::new();
        for pid in &linked_pids {
            let Some(process) = system.process(*pid) else {
                continue;
            };
            let disk = process.disk_usage();
            per_process_raw.push((
                pid.as_u32(),
                process.name().to_string_lossy().into_owned(),
                process.cpu_usage(),
                process.memory(),
                disk.total_read_bytes,
                disk.total_written_bytes,
            ));
        }
        (linked_pids, per_process_raw, cpu_cores)
    };

    let linked_ids: HashSet<u32> = linked_pids.iter().map(|pid| pid.as_u32()).collect();
    let gpu_usage = query_gpu_usage(&linked_ids);

    let mut processes: Vec<PerformanceProcess> = per_process_raw
        .into_iter()
        .map(|(pid, name, cpu_raw, memory, disk_read, disk_write)| {
            let cpu_percent = (cpu_raw / cpu_cores).clamp(0.0, 100.0);
            let gpu_percent = gpu_usage.as_ref().map(|usage| {
                usage
                    .get(&pid)
                    .copied()
                    .unwrap_or_default()
                    .clamp(0.0, 100.0)
            });
            PerformanceProcess {
                pid,
                name,
                cpu_percent,
                memory_bytes: memory,
                disk_read_bytes: disk_read,
                disk_write_bytes: disk_write,
                gpu_percent,
            }
        })
        .collect();
    processes.sort_by(|left, right| {
        right
            .cpu_percent
            .total_cmp(&left.cpu_percent)
            .then_with(|| left.name.cmp(&right.name))
    });

    let cpu_percent = processes
        .iter()
        .map(|process| process.cpu_percent)
        .sum::<f32>()
        .clamp(0.0, 100.0);
    let memory_bytes = processes.iter().map(|process| process.memory_bytes).sum();
    let disk_read_bytes = processes
        .iter()
        .map(|process| process.disk_read_bytes)
        .sum();
    let disk_write_bytes = processes
        .iter()
        .map(|process| process.disk_write_bytes)
        .sum();
    let gpu_percent = gpu_usage.as_ref().map(|usage| {
        processes
            .iter()
            .map(|process| usage.get(&process.pid).copied().unwrap_or_default())
            .sum::<f32>()
            .clamp(0.0, 100.0)
    });

    Ok(PerformanceMetrics {
        processes,
        cpu_percent,
        memory_bytes,
        disk_read_bytes,
        disk_write_bytes,
        gpu_percent,
    })
}
