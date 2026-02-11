fn main() {
    // 设置 Windows 平台的构建属性
    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("app.manifest")); // 引入刚才创建的文件

    // 开始构建
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run build script");
}