#![windows_subsystem = "windows"]
fn main() -> std::io::Result<()> {
    let executable = std::env::current_exe()?.with_file_name("nowly.exe");
    std::process::Command::new(executable)
        .arg("--background")
        .spawn()?;
    Ok(())
}
