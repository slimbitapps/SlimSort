// Unter Windows kein zusätzliches Konsolenfenster öffnen
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    slimsort_lib::run()
}
