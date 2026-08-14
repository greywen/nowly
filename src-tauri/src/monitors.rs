use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct MonitorInfo {
    pub id:String, pub name:String, pub is_primary:bool,
    pub position_x:i32, pub position_y:i32, pub width:u32, pub height:u32, pub scale_factor:f64,
}

// A monitor's stable identity. The OS name is preferred; when it is absent we
// fall back to the physical position so the id is still deterministic. Both
// listing (what the UI saves) and positioning (what moves the window) must
// derive the id the same way, otherwise a nameless monitor could be selected in
// settings yet never matched when positioning, silently reverting to primary.
pub fn monitor_id(name:Option<&str>, position_x:i32, position_y:i32)->String{
    match name {
        Some(name) if !name.is_empty() => name.to_owned(),
        _ => format!("display:{position_x}:{position_y}"),
    }
}

pub fn select_target_monitor<'a>(monitors:&'a [MonitorInfo], saved:Option<&str>)->Option<&'a MonitorInfo>{
    saved.and_then(|id|monitors.iter().find(|monitor|monitor.id==id))
        .or_else(||monitors.iter().find(|monitor|monitor.is_primary))
        .or_else(||monitors.first())
}

pub fn position_target<R:tauri::Runtime>(window:&tauri::Window<R>, saved:Option<&str>)->Result<(),crate::error::CommandError>{
    let monitors=window.available_monitors().map_err(crate::error::CommandError::system)?;
    let primary=window.primary_monitor().map_err(crate::error::CommandError::system)?;
    let selected=saved.and_then(|id|monitors.iter().find(|monitor|{
            let position=monitor.position();
            monitor_id(monitor.name().map(String::as_str),position.x,position.y)==id
        }))
        .or_else(||primary.as_ref())
        .or_else(||monitors.first())
        .ok_or_else(||crate::error::CommandError::system("no monitor available"))?;
    window.set_position(tauri::Position::Physical(*selected.position())).map_err(crate::error::CommandError::system)
}

#[tauri::command]
pub fn list_monitors(window:tauri::Window)->Result<Vec<MonitorInfo>,crate::error::CommandError>{
    let primary=window.primary_monitor().map_err(crate::error::CommandError::system)?;
    let monitors=window.available_monitors().map_err(crate::error::CommandError::system)?;
    Ok(monitors.into_iter().map(|monitor|{
        let position=monitor.position(); let size=monitor.size();
        let id=monitor_id(monitor.name().map(String::as_str),position.x,position.y);
        let name=monitor.name().cloned().unwrap_or_else(||id.clone());
        let is_primary=primary.as_ref().is_some_and(|value|value.position()==monitor.position()&&value.size()==monitor.size());
        MonitorInfo{id,name,is_primary,position_x:position.x,position_y:position.y,width:size.width,height:size.height,scale_factor:monitor.scale_factor()}
    }).collect())
}

#[cfg(test)]
mod tests {
    use super::{monitor_id, select_target_monitor, MonitorInfo};
    fn monitor(id:&str, primary:bool)->MonitorInfo { MonitorInfo{id:id.into(),name:id.into(),is_primary:primary,position_x:0,position_y:0,width:1920,height:1080,scale_factor:1.0} }
    #[test]
    fn named_monitor_uses_the_os_name_as_id(){
        assert_eq!(monitor_id(Some("\\\\.\\DISPLAY2"),1920,0),"\\\\.\\DISPLAY2");
    }
    #[test]
    fn nameless_monitor_falls_back_to_a_deterministic_position_id(){
        // A missing or empty name must yield the same synthetic id in listing and
        // positioning so the saved selection can still be matched.
        assert_eq!(monitor_id(None,1920,0),"display:1920:0");
        assert_eq!(monitor_id(Some(""),-1080,240),"display:-1080:240");
    }
    #[test]
    fn saved_monitor_wins_and_disconnect_falls_back_without_changing_saved_id(){
        let monitors=vec![monitor("primary",true),monitor("saved",false)];
        assert_eq!(select_target_monitor(&monitors,Some("saved")).unwrap().id,"saved");
        let fallback=select_target_monitor(&monitors[..1],Some("saved")).unwrap();
        assert_eq!(fallback.id,"primary");
    }
    #[test]
    fn no_preference_uses_primary(){
        let monitors=vec![monitor("secondary",false),monitor("primary",true)];
        assert_eq!(select_target_monitor(&monitors,None).unwrap().id,"primary");
    }
}
