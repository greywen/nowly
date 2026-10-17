use super::scroll_worker::{ScrollMachine, ScrollPhase};

#[test]
fn scroll_auxiliary_windows_bypass_main_hide_to_tray_close_handler() {
    let source = include_str!("../main.rs");
    let bypass = source
        .find("window.label().starts_with(\"screenshot-scroll-control-\")")
        .expect("scroll controls need native close rather than hide-to-tray");
    let main_close = source
        .find("window.emit(\"request-overlay-cleanup\"")
        .unwrap();
    assert!(bypass < main_close);
}

#[test]
fn main_visibility_snapshot_restores_only_the_same_session_once() {
    let state = super::scroll::ScrollCapture::default();
    state.remember_main(7, true);
    assert_eq!(state.take_main(8), None);
    assert_eq!(state.take_main(7), Some(true));
    assert_eq!(state.take_main(7), None);
    state.remember_main(9, false);
    assert_eq!(state.take_main(9), Some(false));
}

#[test]
fn control_placement_stays_outside_selection_on_signed_monitor() {
    use super::scroll_target::{control_placement, intersects, Region};
    let region = Region {
        x: 0,
        y: 0,
        width: 800,
        height: 600,
    };
    let monitor = Region {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };
    let control = control_placement(region, monitor, 432, 240).unwrap();
    assert!(!intersects(region, control));
    let negative = Region {
        x: -1920,
        y: 0,
        width: 1920,
        height: 1080,
    };
    let region = Region {
        x: -1920,
        y: 0,
        width: 800,
        height: 600,
    };
    let control = control_placement(region, negative, 432, 240).unwrap();
    assert!(control.x < 0);
    assert!(!intersects(region, control));
    assert!(control_placement(monitor, monitor, 432, 240).is_none());
}

#[test]
fn interior_popup_intersection_is_detected_without_sampling_corners() {
    use super::scroll_target::{intersects, Region};
    let region = Region {
        x: 0,
        y: 0,
        width: 800,
        height: 600,
    };
    assert!(intersects(
        region,
        Region {
            x: 100,
            y: 100,
            width: 40,
            height: 40
        }
    ));
    assert!(!intersects(
        region,
        Region {
            x: 800,
            y: 100,
            width: 40,
            height: 40
        }
    ));
}

#[test]
fn scroll_capture_requires_explicit_start_and_stops_before_pause() {
    let mut session = ScrollMachine::default();
    assert!(!session.may_capture());
    session.start().unwrap();
    assert!(session.may_capture());
    session.pause("paused");
    assert!(!session.may_capture());
    session.review("stopped");
    assert_eq!(session.phase, ScrollPhase::Review);
    assert!(!session.may_capture());
}

#[test]
fn target_mismatch_revokes_capture_and_cannot_resume_without_validation() {
    let mut session = ScrollMachine::default();
    session.start().unwrap();
    session.fail("targetChanged");
    assert!(!session.may_capture());
    assert!(session.start().is_err());
}

#[test]
fn escape_discards_prepare_and_review_but_reviews_capture() {
    let mut session = ScrollMachine::default();
    session.escape();
    assert_eq!(session.phase, ScrollPhase::Cancelled);
    let mut session = ScrollMachine::default();
    session.start().unwrap();
    session.escape();
    assert_eq!(session.phase, ScrollPhase::Review);
    session.escape();
    assert_eq!(session.phase, ScrollPhase::Cancelled);
}

#[test]
fn cancel_is_terminal_and_late_worker_cannot_publish() {
    let mut session = ScrollMachine::default();
    session.start().unwrap();
    session.cancel();
    assert!(!session.may_capture());
    assert!(!session.may_publish());
    assert!(session.start().is_err());
}

#[test]
fn scroll_manual_pipeline_never_sends_input_or_expires_sampling() {
    let target = include_str!("scroll_target.rs");
    let worker = include_str!("scroll.rs");
    assert!(
        !target.contains("pub fn wheel"),
        "manual capture must not send wheel messages"
    );
    for source in [target, worker] {
        for input in [
            ".wheel(",
            "WM_MOUSEWHEEL",
            "SendInput(",
            "SendMessage",
            "mouse_event(",
            "SetCursorPos(",
        ] {
            assert!(
                !source.contains(input),
                "manual pipeline must not inject input: {input}"
            );
        }
    }
    assert!(worker.contains("last_frame: Option<Vec<u8>>"));
    assert!(worker.contains("sampler.sample(current, s.last_frame.as_deref())"));
    assert!(worker.contains("s.last_frame = Some(pixels)"));
    assert!(worker.contains("Duration::from_millis(120)"));
    assert!(
        !worker.contains("0..12"),
        "unstable content must keep waiting"
    );
    assert!(
        !worker.contains("prefix[prefix.len() - bytes..]"),
        "resume must use the confirmed viewport"
    );
    let run = worker.split("fn run(").nth(1).unwrap();
    assert!(
        !run.contains("machine.pause("),
        "unchanged content must not pause the worker"
    );
}

#[test]
fn scroll_sampling_waits_for_first_stable_snapshot_and_unlimited_motion() {
    use super::scroll_worker::FrameSampler;
    let mut sampler = FrameSampler::default();
    for value in 0..40 {
        assert_eq!(sampler.sample(vec![value], None), None);
    }
    assert_eq!(sampler.sample(vec![39], None), Some(vec![39]));
}

#[test]
fn scroll_sampling_waits_on_unchanged_content_until_stable_change() {
    use super::scroll_worker::FrameSampler;
    let mut sampler = FrameSampler::default();
    let confirmed = [1];
    for _ in 0..40 {
        assert_eq!(sampler.sample(vec![1], Some(&confirmed)), None);
    }
    assert_eq!(sampler.sample(vec![2], Some(&confirmed)), None);
    assert_eq!(sampler.sample(vec![2], Some(&confirmed)), Some(vec![2]));
    // A no-new-content rejection must not replace the confirmed baseline.
    assert_eq!(sampler.sample(vec![3], Some(&confirmed)), None);
    assert_eq!(sampler.sample(vec![3], Some(&confirmed)), Some(vec![3]));
}

#[test]
fn scroll_resume_samples_changed_viewport_against_last_confirmation() {
    use super::scroll_worker::FrameSampler;
    let confirmed = vec![1];
    let mut resumed = FrameSampler::default();
    assert_eq!(resumed.sample(vec![2], Some(&confirmed)), None);
    assert_eq!(resumed.sample(vec![2], Some(&confirmed)), Some(vec![2]));
    assert_eq!(confirmed, vec![1]);
}

fn scroll_viewport(start: u32) -> Vec<u8> {
    (start..start + 128)
        .flat_map(|row| {
            (0..32).flat_map(move |column| {
                let value = row
                    .wrapping_mul(747796405)
                    .wrapping_add((column as u32).wrapping_mul(2891336453));
                [value as u8, (value >> 11) as u8, (value >> 19) as u8, 255]
            })
        })
        .collect()
}

#[test]
fn scroll_resumed_worker_stitches_from_last_confirmed_viewport() {
    use super::{
        scroll_worker::FrameSampler,
        stitcher::{StitchConfig, StitchOutcome, Stitcher},
    };
    let mut confirmed = scroll_viewport(0);
    let mut stitcher =
        Stitcher::new(StitchConfig::default(), 32, 128, confirmed.clone(), 512).unwrap();
    for start in [32, 64] {
        let mut worker = FrameSampler::default();
        let changed = scroll_viewport(start);
        assert_eq!(worker.sample(changed.clone(), Some(&confirmed)), None);
        let stable = worker.sample(changed, Some(&confirmed)).unwrap();
        assert!(matches!(
            stitcher.offer(32, 128, &stable),
            StitchOutcome::Accepted {
                appended_rows: 32,
                ..
            }
        ));
        confirmed = stable;
    }
    assert_eq!(stitcher.height(), 192);
    assert_eq!(confirmed, scroll_viewport(64));
}

#[test]
fn scroll_capacity_and_unreliable_overlap_preserve_confirmed_partial() {
    use super::stitcher::{RejectReason, StitchConfig, StitchOutcome, Stitcher};
    let first = scroll_viewport(0);
    let mut stitcher = Stitcher::new(StitchConfig::default(), 32, 128, first.clone(), 128).unwrap();
    assert_eq!(
        stitcher.offer(32, 128, &scroll_viewport(32)),
        StitchOutcome::Rejected(RejectReason::CapacityReached)
    );
    assert_eq!(stitcher.confirmed(), first);
    assert!(matches!(
        stitcher.offer(32, 128, &vec![0; first.len()]),
        StitchOutcome::Rejected(_)
    ));
    assert_eq!(stitcher.confirmed(), first);
}

#[test]
fn scroll_no_new_content_waits_without_revoking_capture() {
    use super::{
        scroll_worker::FrameSampler,
        stitcher::{RejectReason, StitchConfig, StitchOutcome, Stitcher},
    };
    let confirmed = scroll_viewport(0);
    let mut stitcher =
        Stitcher::new(StitchConfig::default(), 32, 128, confirmed.clone(), 512).unwrap();
    let mut machine = ScrollMachine::default();
    machine.start().unwrap();
    // Alpha-only changes are invisible to the stitcher's RGB signature.
    let mut candidate = confirmed.clone();
    for alpha in candidate.iter_mut().skip(3).step_by(4) {
        *alpha = 254;
    }
    let mut sampler = FrameSampler::default();
    assert_eq!(sampler.sample(candidate.clone(), Some(&confirmed)), None);
    let stable = sampler.sample(candidate, Some(&confirmed)).unwrap();
    assert_eq!(
        stitcher.offer(32, 128, &stable),
        StitchOutcome::Rejected(RejectReason::NoNewContent)
    );
    assert!(machine.may_capture());
    assert_eq!(stitcher.confirmed(), confirmed);
    assert_eq!(sampler.sample(scroll_viewport(32), Some(&confirmed)), None);
    let next = sampler
        .sample(scroll_viewport(32), Some(&confirmed))
        .unwrap();
    assert!(matches!(
        stitcher.offer(32, 128, &next),
        StitchOutcome::Accepted { .. }
    ));
}
