use serde::Serialize;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ScrollPhase {
    Prepare,
    Capturing,
    Paused,
    Review,
    Cancelled,
}
#[derive(Debug)]
pub(crate) struct ScrollMachine {
    pub phase: ScrollPhase,
    pub reason: Option<String>,
    unsafe_target: bool,
}
impl Default for ScrollMachine {
    fn default() -> Self {
        Self {
            phase: ScrollPhase::Prepare,
            reason: None,
            unsafe_target: false,
        }
    }
}
impl ScrollMachine {
    pub fn start(&mut self) -> Result<(), String> {
        if self.unsafe_target || !matches!(self.phase, ScrollPhase::Prepare | ScrollPhase::Paused) {
            return Err("Scroll session cannot continue.".into());
        }
        self.phase = ScrollPhase::Capturing;
        self.reason = None;
        Ok(())
    }
    pub fn pause(&mut self, reason: &str) {
        if self.phase == ScrollPhase::Capturing {
            self.phase = ScrollPhase::Paused;
            self.reason = Some(reason.into());
        }
    }
    pub fn review(&mut self, reason: &str) {
        if self.phase != ScrollPhase::Cancelled {
            self.phase = ScrollPhase::Review;
            self.reason = Some(reason.into());
        }
    }
    pub fn fail(&mut self, reason: &str) {
        self.unsafe_target = true;
        self.review(reason);
    }
    pub fn escape(&mut self) {
        match self.phase {
            ScrollPhase::Capturing | ScrollPhase::Paused => {
                self.review("Stopped; review the confirmed portion")
            }
            ScrollPhase::Prepare | ScrollPhase::Review => self.cancel(),
            ScrollPhase::Cancelled => {}
        }
    }
    pub fn cancel(&mut self) {
        self.phase = ScrollPhase::Cancelled;
    }
    pub fn may_capture(&self) -> bool {
        self.phase == ScrollPhase::Capturing && !self.unsafe_target
    }
    pub fn may_publish(&self) -> bool {
        self.phase == ScrollPhase::Capturing
    }
}

#[derive(Default)]
pub(crate) struct FrameSampler {
    previous: Option<Vec<u8>>,
}
impl FrameSampler {
    pub fn sample(&mut self, pixels: Vec<u8>, confirmed: Option<&[u8]>) -> Option<Vec<u8>> {
        let stable = self.previous.as_deref() == Some(pixels.as_slice());
        if confirmed == Some(pixels.as_slice()) {
            self.previous = None;
            return None;
        }
        if stable {
            self.previous = None;
            Some(pixels)
        } else {
            self.previous = Some(pixels);
            None
        }
    }
}
