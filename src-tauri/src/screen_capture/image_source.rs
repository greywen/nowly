use super::composite::SelectionRect;

#[derive(Debug)]
pub(crate) struct LongImage {
    pub revision: u64,
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

impl LongImage {
    pub fn new(revision: u64, width: u32, height: u32, rgba: Vec<u8>) -> Result<Self, String> {
        let expected = super::validate_output_dimensions(u64::from(width), u64::from(height))
            .map_err(|error| format!("Invalid long image dimensions: {error:?}"))?;
        if revision == 0 || expected != rgba.len() as u64 {
            return Err("Invalid long image revision or pixel length.".into());
        }
        Ok(Self {
            revision,
            width,
            height,
            rgba,
        })
    }

    pub fn crop(&self, selection: SelectionRect) -> Result<Vec<u8>, String> {
        let x = u32::try_from(selection.x).map_err(|_| "Negative long image crop.")?;
        let y = u32::try_from(selection.y).map_err(|_| "Negative long image crop.")?;
        let len =
            super::validate_output_dimensions(selection.width.into(), selection.height.into())
                .map_err(|_| "Invalid long image crop dimensions.")?;
        if x.checked_add(selection.width)
            .is_none_or(|right| right > self.width)
            || y.checked_add(selection.height)
                .is_none_or(|bottom| bottom > self.height)
        {
            return Err("Long image crop is out of bounds.".into());
        }
        let mut pixels = Vec::with_capacity(len as usize);
        for row in y..y + selection.height {
            let start = ((row as usize) * self.width as usize + x as usize) * 4;
            let end = start + selection.width as usize * 4;
            pixels.extend_from_slice(&self.rgba[start..end]);
        }
        Ok(pixels)
    }
}
