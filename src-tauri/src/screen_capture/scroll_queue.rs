use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};

pub(crate) struct FrameQueue {
    state: Mutex<State>,
    available: Condvar,
    limit: usize,
}

#[derive(Default)]
struct State {
    frames: VecDeque<Vec<u8>>,
    bytes: usize,
    closed: bool,
    previous: Option<Vec<u8>>,
}

impl FrameQueue {
    pub(crate) fn new(limit: usize) -> Self {
        Self { state: Mutex::new(State::default()), available: Condvar::new(), limit }
    }

    pub(crate) fn push(&self, frame: Vec<u8>) -> Result<(), ()> {
        let mut state = self.state.lock().unwrap();
        if state.closed { return Err(()); }
        if state.previous.as_deref() == Some(frame.as_slice()) { return Ok(()); }
        if frame.len() > self.limit.saturating_sub(state.bytes) { return Err(()); }
        state.previous = Some(frame.clone());
        state.bytes += frame.len();
        state.frames.push_back(frame);
        self.available.notify_one();
        Ok(())
    }

    pub(crate) fn pop(&self) -> Option<Vec<u8>> {
        let mut state = self.state.lock().unwrap();
        while state.frames.is_empty() && !state.closed {
            state = self.available.wait(state).unwrap();
        }
        let frame = state.frames.pop_front()?;
        state.bytes -= frame.len();
        Some(frame)
    }

    pub(crate) fn close(&self) {
        let mut state = self.state.lock().unwrap();
        state.closed = true;
        self.available.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffered_frames_preserve_order_without_waiting_for_processing() {
        let queue = FrameQueue::new(12);
        for value in 0..3 { queue.push(vec![value; 4]).unwrap(); }
        queue.close();
        for value in 0..3 { assert_eq!(queue.pop(), Some(vec![value; 4])); }
        assert_eq!(queue.pop(), None);
    }

    #[test]
    fn overflow_is_reported_without_discarding_queued_frames() {
        let queue = FrameQueue::new(4);
        queue.push(vec![1; 4]).unwrap();
        assert!(queue.push(vec![2]).is_err());
        assert_eq!(queue.pop(), Some(vec![1; 4]));
        queue.push(vec![3; 4]).unwrap();
        queue.close();
        assert_eq!(queue.pop(), Some(vec![3; 4]));
        assert!(queue.push(vec![]).is_err());
    }

    #[test]
    fn stationary_desktop_frames_do_not_exhaust_the_capture_buffer() {
        let queue = FrameQueue::new(8);
        for _ in 0..1000 { queue.push(vec![1; 4]).expect("unchanged desktop must not fill queue"); }
        assert_eq!(queue.pop(), Some(vec![1; 4]));
        for _ in 0..1000 { queue.push(vec![1; 4]).unwrap(); }
        queue.push(vec![2; 4]).unwrap();
        queue.close();
        assert_eq!(queue.pop(), Some(vec![2; 4]));
        assert_eq!(queue.pop(), None);
    }

    #[test]
    fn closing_an_empty_queue_wakes_a_waiting_consumer() {
        let queue = std::sync::Arc::new(FrameQueue::new(4));
        let reader = queue.clone();
        let worker = std::thread::spawn(move || reader.pop());
        queue.close();
        assert_eq!(worker.join().unwrap(), None);
    }
}
