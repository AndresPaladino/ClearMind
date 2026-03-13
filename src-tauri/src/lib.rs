use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Once;

type AppResult<T> = Result<T, AppError>;
static LEGACY_MIGRATION_ONCE: Once = Once::new();

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AppError {
    NoWritableBaseDirectory,
    InvalidEntryId { id: String },
    InvalidEntryPath { id: String },
    PathEscapeAttempt { id: String },
    Io { operation: String, details: String },
}

fn io_error(operation: impl Into<String>, error: std::io::Error) -> AppError {
    AppError::Io {
        operation: operation.into(),
        details: error.to_string(),
    }
}

fn app_dir() -> AppResult<PathBuf> {
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .ok_or(AppError::NoWritableBaseDirectory)?;
    let dir = base.join("ClearMind");
    fs::create_dir_all(&dir).map_err(|e| io_error("create_app_directory", e))?;
    Ok(dir)
}

fn is_valid_entry_filename(name: &str) -> bool {
    if !name.ends_with(".md") {
        return false;
    }

    let stem = &name[..name.len() - 3];
    let mut parts = stem.splitn(2, '_');
    let date = match parts.next() {
        Some(v) => v,
        None => return false,
    };
    let number = match parts.next() {
        Some(v) => v,
        None => return false,
    };

    let date_parts: Vec<&str> = date.split('-').collect();
    if date_parts.len() != 3 {
        return false;
    }
    if !date_parts
        .iter()
        .all(|p| p.len() == 2 && p.chars().all(|c| c.is_ascii_digit()))
    {
        return false;
    }

    number.parse::<u32>().map(|n| n > 0).unwrap_or(false)
}

fn migrate_legacy_entries(root: &PathBuf, entries: &PathBuf) -> AppResult<()> {
    let Ok(files) = fs::read_dir(root) else {
        return Ok(());
    };

    for file in files.filter_map(|f| f.ok()) {
        let path = file.path();
        if !path.is_file() {
            continue;
        }

        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };

        if !is_valid_entry_filename(name) {
            continue;
        }

        let target = entries.join(name);
        if !target.exists() {
            fs::rename(&path, &target).map_err(|e| {
                io_error(
                    format!(
                        "migrate_legacy_entry:{}->{}",
                        path.display(),
                        target.display()
                    ),
                    e,
                )
            })?;
        }
    }

    Ok(())
}

fn entries_dir() -> AppResult<PathBuf> {
    let root = app_dir()?;
    let dir = root.join(".entries");
    fs::create_dir_all(&dir).map_err(|e| io_error("create_entries_directory", e))?;

    let migration_root = root.clone();
    let migration_dir = dir.clone();
    LEGACY_MIGRATION_ONCE.call_once(|| {
        if let Err(error) = migrate_legacy_entries(&migration_root, &migration_dir) {
            eprintln!("legacy entry migration failed: {:?}", error);
        }
    });

    Ok(dir)
}

fn date_str_today() -> String {
    Local::now().format("%d-%m-%y").to_string()
}

fn display_date_today() -> String {
    Local::now().format("%d/%m/%y").to_string()
}

fn entries_for_date(date_str: &str) -> AppResult<Vec<PathBuf>> {
    let dir = entries_dir()?;
    let read_dir = fs::read_dir(&dir).map_err(|e| io_error("read_entries_directory", e))?;
    let mut entries: Vec<PathBuf> = read_dir
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            let Some(name) = p.file_name().and_then(|n| n.to_str()) else {
                return false;
            };
            if !is_valid_entry_filename(name) {
                return false;
            }
            let stem = &name[..name.len() - 3];
            stem.splitn(2, '_').next().map(|d| d == date_str).unwrap_or(false)
        })
        .collect();
    entries.sort();
    Ok(entries)
}

/// Validate an entry ID and return a safe path within the entries directory.
/// Returns None if the ID is invalid or would escape the entries dir.
fn safe_entry_path(id: &str) -> AppResult<PathBuf> {
    let filename = format!("{}.md", id);
    if !is_valid_entry_filename(&filename) {
        return Err(AppError::InvalidEntryId { id: id.to_string() });
    }
    let dir = entries_dir()?;
    let path = dir.join(&filename);

    let canonical_dir = dir
        .canonicalize()
        .map_err(|e| io_error("canonicalize_entries_directory", e))?;

    // Canonicalize to resolve any ../ tricks
    let canonical = path.canonicalize().ok().or_else(|| {
        // File may not exist yet — check that parent is the entries dir
        let parent = path.parent()?;
        let canonical_parent = parent.canonicalize().ok()?;
        if canonical_parent == canonical_dir {
            Some(path.clone())
        } else {
            None
        }
    });

    let canonical = canonical.ok_or_else(|| AppError::InvalidEntryPath { id: id.to_string() })?;

    if canonical.starts_with(&canonical_dir) {
        Ok(path)
    } else {
        Err(AppError::PathEscapeAttempt { id: id.to_string() })
    }
}

fn entry_number_from_path(path: &PathBuf) -> u32 {
    path.file_stem()
        .and_then(|s| s.to_str())
        .and_then(|s| s.rsplit('_').next())
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0)
}

fn is_sealed(path: &PathBuf) -> bool {
    if let Ok(content) = fs::read_to_string(path) {
        content.trim().ends_with("<!-- sealed -->")
    } else {
        false
    }
}

fn clean_entry_content(content: &str) -> String {
    let trimmed = content.trim_end();
    if let Some(without_marker) = trimmed.strip_suffix("<!-- sealed -->") {
        without_marker.trim_end().to_string()
    } else {
        trimmed.to_string()
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct Entry {
    id: String,
    date: String,
    number: u32,
    content: String,
    sealed: bool,
}

#[tauri::command]
fn get_current_entry() -> AppResult<Entry> {
    let date_str = date_str_today();
    let display_date = display_date_today();
    let entries = entries_for_date(&date_str)?;

    // Find last unsealed entry for today
    for path in entries.iter().rev() {
        if !is_sealed(path) {
            let number = entry_number_from_path(path);
            let content = fs::read_to_string(path).unwrap_or_default();
            let clean_content = clean_entry_content(&content);
            return Ok(Entry {
                id: format!("{}_{}", date_str, number),
                date: display_date,
                number,
                content: clean_content,
                sealed: false,
            });
        }
    }

    // All sealed or no entries → create new
    let next_number = (entries.len() as u32) + 1;

    let filename = format!("{}_{}.md", date_str, next_number);
    let path = entries_dir()?.join(&filename);
    fs::write(&path, "").map_err(|e| io_error("create_entry_file", e))?;

    Ok(Entry {
        id: format!("{}_{}", date_str, next_number),
        date: display_date,
        number: next_number,
        content: String::new(),
        sealed: false,
    })
}

#[tauri::command]
fn save_entry(id: String, content: String) -> AppResult<bool> {
    let path = safe_entry_path(&id)?;
    fs::write(&path, &content).map_err(|e| io_error("save_entry_file", e))?;
    Ok(true)
}

#[tauri::command]
fn seal_entry(id: String, content: String) -> AppResult<Entry> {
    let path = safe_entry_path(&id)?;
    let sealed_content = format!("{}\n\n<!-- sealed -->", content.trim());
    fs::write(&path, &sealed_content).map_err(|e| io_error("seal_entry_file", e))?;

    // Create next entry
    get_current_entry()
}

#[tauri::command]
fn get_all_entries() -> AppResult<Vec<Entry>> {
    let dir = entries_dir()?;
    let mut paths: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(|e| io_error("list_entry_files", e))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(is_valid_entry_filename)
                .unwrap_or(false)
        })
        .collect();
    paths.sort();

    let result = paths
        .iter()
        .map(|path| {
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let parts: Vec<&str> = stem.splitn(2, '_').collect();
            let date_part = parts.first().unwrap_or(&"");
            let number: u32 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            let display_date = date_part.replace('-', "/");
            let content = fs::read_to_string(path).unwrap_or_default();
            let sealed = content.trim().ends_with("<!-- sealed -->");
            let clean_content = clean_entry_content(&content);

            Entry {
                id: stem.to_string(),
                date: display_date,
                number,
                content: clean_content,
                sealed,
            }
        })
        .collect();

    Ok(result)
}

/// Renumber all .md files for a given date so they are sequential: _1, _2, _3...
fn renumber_entries_for_date(date_str: &str) -> AppResult<()> {
    let entries = entries_for_date(date_str)?;
    let dir = entries_dir()?;

    for (i, old_path) in entries.iter().enumerate() {
        let new_number = (i as u32) + 1;
        let new_filename = format!("{}_{}.md", date_str, new_number);
        let new_path = dir.join(&new_filename);
        if *old_path != new_path {
            fs::rename(old_path, &new_path).map_err(|e| {
                io_error(
                    format!("renumber_entry:{}->{}", old_path.display(), new_path.display()),
                    e,
                )
            })?;
        }
    }

    Ok(())
}

#[tauri::command]
fn unseal_entry(id: String) -> AppResult<bool> {
    let path = safe_entry_path(&id)?;
    let content = fs::read_to_string(&path).map_err(|e| io_error("read_entry_file", e))?;
    let clean = clean_entry_content(&content);
    fs::write(&path, &clean).map_err(|e| io_error("unseal_entry_file", e))?;
    Ok(true)
}

#[tauri::command]
fn delete_entry(id: String) -> AppResult<bool> {
    let path = safe_entry_path(&id)?;
    fs::remove_file(&path).map_err(|e| io_error("delete_entry_file", e))?;

    // Extract date part and renumber remaining files for that day
    let parts: Vec<&str> = id.splitn(2, '_').collect();
    if let Some(date_str) = parts.first() {
        renumber_entries_for_date(date_str)?;
    }

    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_current_entry,
            save_entry,
            seal_entry,
            get_all_entries,
            delete_entry,
            unseal_entry,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
