use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

fn app_dir() -> PathBuf {
    let base = dirs::document_dir().unwrap_or_else(|| dirs::home_dir().unwrap());
    let dir = base.join("ClearMind");
    fs::create_dir_all(&dir).ok();
    dir
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

fn migrate_legacy_entries(root: &PathBuf, entries: &PathBuf) {
    let Ok(files) = fs::read_dir(root) else {
        return;
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
            fs::rename(&path, &target).ok();
        }
    }
}

fn entries_dir() -> PathBuf {
    let root = app_dir();
    let dir = root.join(".entries");
    fs::create_dir_all(&dir).ok();
    migrate_legacy_entries(&root, &dir);
    dir
}

fn date_str_today() -> String {
    Local::now().format("%d-%m-%y").to_string()
}

fn display_date_today() -> String {
    Local::now().format("%d/%m/%y").to_string()
}

fn entries_for_date(date_str: &str) -> Vec<PathBuf> {
    let dir = entries_dir();
    let Ok(read_dir) = fs::read_dir(&dir) else {
        return Vec::new();
    };
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
    entries
}

/// Validate an entry ID and return a safe path within the entries directory.
/// Returns None if the ID is invalid or would escape the entries dir.
fn safe_entry_path(id: &str) -> Option<PathBuf> {
    let filename = format!("{}.md", id);
    if !is_valid_entry_filename(&filename) {
        return None;
    }
    let dir = entries_dir();
    let path = dir.join(&filename);
    // Canonicalize to resolve any ../ tricks
    let canonical = path.canonicalize().ok().or_else(|| {
        // File may not exist yet — check that parent is the entries dir
        let parent = path.parent()?;
        let canonical_parent = parent.canonicalize().ok()?;
        let canonical_dir = dir.canonicalize().ok()?;
        if canonical_parent == canonical_dir {
            Some(path.clone())
        } else {
            None
        }
    })?;
    let canonical_dir = dir.canonicalize().ok()?;
    if canonical.starts_with(&canonical_dir) {
        Some(path)
    } else {
        None
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
        content.contains("<!-- sealed -->")
    } else {
        false
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
fn get_current_entry() -> Result<Entry, String> {
    let date_str = date_str_today();
    let display_date = display_date_today();
    let entries = entries_for_date(&date_str);

    // Find last unsealed entry for today
    for path in entries.iter().rev() {
        if !is_sealed(path) {
            let number = entry_number_from_path(path);
            let content = fs::read_to_string(path).unwrap_or_default();
            let clean_content = content.replace("<!-- sealed -->", "").trim().to_string();
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
    let path = entries_dir().join(&filename);
    fs::write(&path, "").map_err(|e| format!("Failed to create entry: {}", e))?;

    Ok(Entry {
        id: format!("{}_{}", date_str, next_number),
        date: display_date,
        number: next_number,
        content: String::new(),
        sealed: false,
    })
}

#[tauri::command]
fn save_entry(id: String, content: String) -> Result<bool, String> {
    let path = safe_entry_path(&id).ok_or_else(|| format!("Invalid entry id: {}", id))?;
    fs::write(&path, &content).map_err(|e| format!("Failed to save entry: {}", e))?;
    Ok(true)
}

#[tauri::command]
fn seal_entry(id: String, content: String) -> Result<Entry, String> {
    let path = safe_entry_path(&id).ok_or_else(|| format!("Invalid entry id: {}", id))?;
    let sealed_content = format!("{}\n\n<!-- sealed -->", content.trim());
    fs::write(&path, &sealed_content).map_err(|e| format!("Failed to seal entry: {}", e))?;

    // Create next entry
    get_current_entry()
}

#[tauri::command]
fn get_all_entries() -> Result<Vec<Entry>, String> {
    let dir = entries_dir();
    let mut paths: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read entries: {}", e))?
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
            let sealed = content.contains("<!-- sealed -->");
            let clean_content = content.replace("<!-- sealed -->", "").trim().to_string();

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
fn renumber_entries_for_date(date_str: &str) {
    let entries = entries_for_date(date_str);
    let dir = entries_dir();

    for (i, old_path) in entries.iter().enumerate() {
        let new_number = (i as u32) + 1;
        let new_filename = format!("{}_{}.md", date_str, new_number);
        let new_path = dir.join(&new_filename);
        if *old_path != new_path {
            fs::rename(old_path, &new_path).ok();
        }
    }
}

#[tauri::command]
fn unseal_entry(id: String) -> Result<bool, String> {
    let path = safe_entry_path(&id).ok_or_else(|| format!("Invalid entry id: {}", id))?;
    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read entry: {}", e))?;
    let clean = content.replace("<!-- sealed -->", "").trim().to_string();
    fs::write(&path, &clean).map_err(|e| format!("Failed to unseal entry: {}", e))?;
    Ok(true)
}

#[tauri::command]
fn delete_entry(id: String) -> Result<bool, String> {
    let path = safe_entry_path(&id).ok_or_else(|| format!("Invalid entry id: {}", id))?;
    fs::remove_file(&path).map_err(|e| format!("Failed to delete entry: {}", e))?;

    // Extract date part and renumber remaining files for that day
    let parts: Vec<&str> = id.splitn(2, '_').collect();
    if let Some(date_str) = parts.first() {
        renumber_entries_for_date(date_str);
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
