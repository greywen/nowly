//! Joining scroll frames without guessing.
//!
//! §6.4 of the design is mostly a list of things this must refuse to do. The single
//! rule behind all of them: a seam is only accepted when the evidence is
//! *unambiguous*. Image similarity alone is not evidence, because the content that
//! breaks it is ordinary — a monochrome block, a repeated list row, a virtual list
//! that re-renders. Any of those produce several equally good matches, and picking one
//! would silently drop or duplicate content in a file the user believes is faithful.
//!
//! So every frame is scored against the confirmed tail at every candidate offset, and
//! the result is accepted only when the best candidate is both good on its own and
//! clearly better than the next distinct one. Everything else is reported with a
//! reason, and the confirmed prefix is left untouched.
//!
//! On thresholds: §6.4 says they must be calibrated against a validation set and that
//! a third party's default is not evidence. The values here are calibrated against the
//! synthetic set in this module's tests, which covers the specific failure shapes the
//! spec names. That is *not* evidence about real applications, and the validation
//! document records it as such.

/// Per-row signature width. Column buckets rather than whole-row sums, so two
/// different rows that happen to share a total are still told apart.
const BUCKETS: usize = 8;

/// The worst-matching bucket is dropped from every row's score.
///
/// This is what tolerates a scrollbar thumb, a narrow dynamic sidebar or a live clock:
/// they occupy a small column range, so they land in one bucket, and dropping the
/// worst bucket removes their influence without needing to detect them. Dropping only
/// one keeps it from hiding a real mismatch.
const TRIMMED_BUCKETS: usize = 1;

/// Channels per bucket.
const CHANNELS: usize = 3;

/// Fixed-point scale for signature values, so a mean keeps sub-unit precision.
const SCALE: u32 = 256;

/// How far either side of the best candidate is excluded when looking for the runner-up.
///
/// Offsets next to the best one score almost as well on smoothly varying content, and
/// treating that as ambiguity would reject every gradient. The runner-up has to be a
/// genuinely different alignment.
const RUNNER_UP_EXCLUSION: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct StitchConfig {
    /// Rows of the confirmed tail used as the match band.
    pub band_rows: u32,
    /// Highest mean absolute difference, in fixed point, that can be accepted.
    pub accept_score: u32,
    /// How much worse the runner-up must be before the best is considered unambiguous.
    pub ambiguity_margin: u32,
    /// Lowest spread within the band for it to carry usable information.
    pub min_band_spread: u32,
    /// Rows the new frame must share with the confirmed image.
    pub min_overlap_rows: u32,
    /// Rows excluded from the top of every frame, for a fixed header.
    pub exclude_top_rows: u32,
    /// Rows excluded from the bottom of every frame, for a fixed footer.
    pub exclude_bottom_rows: u32,
}

impl Default for StitchConfig {
    fn default() -> Self {
        Self {
            band_rows: 24,
            // 6.0 mean absolute difference per channel.
            accept_score: 6 * SCALE,
            // The runner-up must be at least 8.0 worse.
            ambiguity_margin: 8 * SCALE,
            // The band's rows must differ from each other by at least 2.0 on average.
            min_band_spread: 2 * SCALE,
            min_overlap_rows: 24,
            exclude_top_rows: 0,
            exclude_bottom_rows: 0,
        }
    }
}

/// Why a frame was not appended. Every variant carries what the user or a log needs
/// to understand the stop, per §6.4's diagnosability requirement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RejectReason {
    /// The frame's width does not match the confirmed image.
    SizeMismatch,
    /// The frame is shorter than the band plus the required overlap.
    FrameTooShort,
    /// No candidate scored well enough to be a match at all.
    NoOverlap { best: u32 },
    /// Several alignments are equally good, so choosing one would be a guess.
    Ambiguous { best: u32, runner_up: u32 },
    /// The band is too uniform to identify a position, e.g. a blank area.
    LowInformation { spread: u32 },
    /// The frame matches but contributes nothing below the overlap.
    NoNewContent,
    /// Appending would exceed the output budget.
    CapacityReached,
}

/// The outcome of offering one frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StitchOutcome {
    Accepted {
        /// Row in the new frame where the confirmed tail was found. With
        /// `appended_rows` this is the full alignment §6.4 asks to be reportable.
        offset: u32,
        /// Rows appended below the overlap.
        ///
        /// This *is* the measured scroll displacement: the confirmed tail used to be
        /// at the frame's bottom and is now `appended_rows` higher. It is not reported
        /// again under a second name, because two fields holding one number invite a
        /// reader to believe they corroborate each other.
        appended_rows: u32,
        score: u32,
        /// `None` when the frame is too short for a distinct runner-up to exist.
        runner_up: Option<u32>,
    },
    Rejected(RejectReason),
}

/// The confirmed long image, plus the decision log.
///
/// The confirmed prefix is the only thing that ever reaches the preview or the export.
/// A rejected frame changes nothing, which is what §6.4 means by keeping the last
/// confirmed pixel range.
#[derive(Debug)]
pub(crate) struct Stitcher {
    config: StitchConfig,
    width: u32,
    /// Straight RGBA, `width * height * 4`.
    confirmed: Vec<u8>,
    height: u32,
    /// Per-row signatures of the confirmed image, kept so a match does not rebuild them.
    signatures: Vec<u32>,
    max_height: u32,
    log: Vec<StitchOutcome>,
}

impl Stitcher {
    /// Starts from the first frame, which needs no match.
    ///
    /// §6.2 requires a freshly captured first frame rather than the frozen base image,
    /// but that is the caller's concern; here it is simply the starting prefix.
    ///
    /// A fixed footer is trimmed from the confirmed image, so it occurs zero times
    /// rather than once. §6.4 permits "at most once", and the asymmetry with the header
    /// is deliberate: the header sits at the top of the first frame, which *is* the top
    /// of the result, so keeping it is correct. A footer sits at the bottom of every
    /// frame, but only the last frame's bottom is the result's bottom, and at capture
    /// time there is no way to know which frame is last. Keeping the first frame's
    /// footer would bury it in the middle of the image, which is worse than dropping
    /// it.
    pub(crate) fn new(
        config: StitchConfig,
        width: u32,
        height: u32,
        rgba: Vec<u8>,
        max_height: u32,
    ) -> Option<Self> {
        if width == 0 || height == 0 {
            return None;
        }
        if rgba.len() != (width as usize) * (height as usize) * 4 {
            return None;
        }
        if height <= config.exclude_bottom_rows {
            return None;
        }
        let kept = height - config.exclude_bottom_rows;
        let mut rgba = rgba;
        rgba.truncate((kept as usize) * (width as usize) * 4);
        let signatures = row_signatures(&rgba, width, kept, config);
        Some(Self {
            config,
            width,
            confirmed: rgba,
            height: kept,
            signatures,
            max_height,
            log: Vec::new(),
        })
    }

    pub(crate) fn width(&self) -> u32 {
        self.width
    }

    pub(crate) fn height(&self) -> u32 {
        self.height
    }

    /// The confirmed pixels. Never contains a pending or rejected frame.
    pub(crate) fn confirmed(&self) -> &[u8] {
        &self.confirmed
    }

    /// Every decision so far, oldest first.
    pub(crate) fn log(&self) -> &[StitchOutcome] {
        &self.log
    }

    /// Offers one frame. On acceptance the new rows are appended; otherwise nothing
    /// changes.
    pub(crate) fn offer(&mut self, width: u32, height: u32, rgba: &[u8]) -> StitchOutcome {
        let outcome = self.evaluate(width, height, rgba);
        if let StitchOutcome::Accepted {
            offset,
            appended_rows,
            ..
        } = outcome
        {
            let start = ((offset + self.config.band_rows) as usize) * (width as usize) * 4;
            let end = start + (appended_rows as usize) * (width as usize) * 4;
            self.confirmed.extend_from_slice(&rgba[start..end]);
            let appended_signatures = row_signatures_range(
                rgba,
                width,
                offset + self.config.band_rows,
                appended_rows,
                self.config,
            );
            self.signatures.extend_from_slice(&appended_signatures);
            self.height += appended_rows;
        }
        self.log.push(outcome);
        outcome
    }

    /// Decides without mutating, so the append stays a separate step.
    fn evaluate(&self, width: u32, height: u32, rgba: &[u8]) -> StitchOutcome {
        if width != self.width || rgba.len() != (width as usize) * (height as usize) * 4 {
            return StitchOutcome::Rejected(RejectReason::SizeMismatch);
        }

        let band = self.config.band_rows;
        let top = self.config.exclude_top_rows;
        let bottom = self.config.exclude_bottom_rows;
        // The searchable part of the frame, with any fixed header and footer removed.
        // A fixed header would otherwise match the band wherever the header happens to
        // resemble it, and §6.4 also requires it to appear at most once in the result.
        if height <= top + bottom {
            return StitchOutcome::Rejected(RejectReason::FrameTooShort);
        }
        let searchable = height - top - bottom;
        if searchable < band || self.height < band {
            return StitchOutcome::Rejected(RejectReason::FrameTooShort);
        }

        // A band of identical rows matches anywhere, so there is nothing to conclude
        // from a good score. Reported separately from ambiguity because the fix is
        // different: the user has to scroll to content that has structure.
        let spread = band_spread(&self.signatures, self.height, band);
        if spread < self.config.min_band_spread {
            return StitchOutcome::Rejected(RejectReason::LowInformation { spread });
        }

        let frame_signatures = row_signatures(rgba, width, height, self.config);
        let band_start = ((self.height - band) as usize) * BUCKETS * CHANNELS;
        let band_signature = &self.signatures[band_start..];

        // Candidate offsets are absolute rows in the frame, within the searchable part.
        let first = top;
        let last = top + searchable - band;
        let mut best = (first, u32::MAX);
        let mut scores = Vec::with_capacity((last - first + 1) as usize);
        for offset in first..=last {
            let start = (offset as usize) * BUCKETS * CHANNELS;
            let score = band_score(band_signature, &frame_signatures[start..], band);
            scores.push((offset, score));
            if score < best.1 {
                best = (offset, score);
            }
        }

        if best.1 > self.config.accept_score {
            return StitchOutcome::Rejected(RejectReason::NoOverlap { best: best.1 });
        }

        // The runner-up has to be a different alignment, not a neighbouring row of the
        // same one.
        let runner_up = scores
            .iter()
            .filter(|(offset, _)| offset.abs_diff(best.0) > RUNNER_UP_EXCLUSION)
            .map(|(_, score)| *score)
            .min();
        if let Some(runner_up) = runner_up {
            if runner_up < best.1.saturating_add(self.config.ambiguity_margin) {
                return StitchOutcome::Rejected(RejectReason::Ambiguous {
                    best: best.1,
                    runner_up,
                });
            }
        }

        // Everything above the band's end in the frame is already in the confirmed
        // image; only what is below it is new.
        let consumed = best.0 + band;
        let overlap = consumed;
        if overlap < self.config.min_overlap_rows {
            return StitchOutcome::Rejected(RejectReason::NoOverlap { best: best.1 });
        }
        // The footer is excluded from the append as well as from the search, so it is
        // kept once, from the first frame, instead of once per frame.
        let available = height - bottom;
        if available <= consumed {
            // A perfect match with nothing below it: the view did not move. §6.3 allows
            // this to pause the capture, but only with a message that does not claim
            // the bottom was reached.
            return StitchOutcome::Rejected(RejectReason::NoNewContent);
        }
        let appended_rows = available - consumed;
        if self.height.saturating_add(appended_rows) > self.max_height {
            return StitchOutcome::Rejected(RejectReason::CapacityReached);
        }

        StitchOutcome::Accepted {
            offset: best.0,
            appended_rows,
            score: best.1,
            runner_up,
        }
    }
}

/// Mean of each channel over each column bucket, in fixed point, for every row.
fn row_signatures(rgba: &[u8], width: u32, height: u32, config: StitchConfig) -> Vec<u32> {
    row_signatures_range(rgba, width, 0, height, config)
}

fn row_signatures_range(
    rgba: &[u8],
    width: u32,
    first_row: u32,
    rows: u32,
    _config: StitchConfig,
) -> Vec<u32> {
    let mut out = Vec::with_capacity((rows as usize) * BUCKETS * CHANNELS);
    for row in first_row..first_row + rows {
        let row_start = (row as usize) * (width as usize) * 4;
        for bucket in 0..BUCKETS {
            // Column ranges split as evenly as the width allows; the last bucket takes
            // the remainder rather than leaving columns unexamined.
            let from = (bucket * width as usize) / BUCKETS;
            let to = ((bucket + 1) * width as usize) / BUCKETS;
            let count = (to - from).max(1) as u32;
            let mut sums = [0u32; CHANNELS];
            for column in from..to {
                let pixel = row_start + column * 4;
                for channel in 0..CHANNELS {
                    sums[channel] += rgba[pixel + channel] as u32;
                }
            }
            for channel in 0..CHANNELS {
                out.push((sums[channel] * SCALE) / count);
            }
        }
    }
    out
}

/// Mean absolute difference over `rows` rows, dropping each row's worst bucket.
fn band_score(left: &[u32], right: &[u32], rows: u32) -> u32 {
    let mut total = 0u64;
    let mut counted = 0u64;
    for row in 0..rows as usize {
        let base = row * BUCKETS * CHANNELS;
        let mut per_bucket = [0u64; BUCKETS];
        for bucket in 0..BUCKETS {
            let mut sum = 0u64;
            for channel in 0..CHANNELS {
                let index = base + bucket * CHANNELS + channel;
                sum += left[index].abs_diff(right[index]) as u64;
            }
            per_bucket[bucket] = sum;
        }
        per_bucket.sort_unstable();
        // The worst buckets are dropped, which is what absorbs a scrollbar or a narrow
        // dynamic region without having to find it first.
        for value in per_bucket.iter().take(BUCKETS - TRIMMED_BUCKETS) {
            total += value;
            counted += CHANNELS as u64;
        }
    }
    if counted == 0 {
        return u32::MAX;
    }
    (total / counted) as u32
}

/// How much the band's rows differ from one another.
///
/// Measured against the band's own mean rather than between neighbours, so a slow
/// gradient still counts as information while a flat block does not.
fn band_spread(signatures: &[u32], height: u32, band: u32) -> u32 {
    let start = ((height - band) as usize) * BUCKETS * CHANNELS;
    let values = &signatures[start..];
    let per_row = BUCKETS * CHANNELS;
    let mut total = 0u64;
    let mut counted = 0u64;
    for index in 0..per_row {
        let mean = (0..band as usize)
            .map(|row| values[row * per_row + index] as u64)
            .sum::<u64>()
            / band as u64;
        for row in 0..band as usize {
            total += (values[row * per_row + index] as u64).abs_diff(mean);
            counted += 1;
        }
    }
    if counted == 0 {
        return 0;
    }
    (total / counted) as u32
}

#[cfg(test)]
mod tests {
    use super::{RejectReason, StitchConfig, StitchOutcome, Stitcher};

    const WIDTH: u32 = 64;
    /// Generous, so capacity is not accidentally the thing under test.
    const MAX_HEIGHT: u32 = 100_000;

    /// A long page whose every row is identifiable on sight.
    ///
    /// Built independently of the stitcher: the row index is written into the pixels
    /// through a fixed formula, so "row 37 of the source" can be asserted in the
    /// output. A seam that drops or duplicates rows changes that sequence, which is
    /// exactly what a similarity check would miss.
    ///
    /// `r` and `g` carry the row number so it can be read back. Those two alone are not
    /// enough: they make rows exactly 251 apart differ by 1 in a single channel, which
    /// is a real near-duplicate, and a first version of this generator produced one. The
    /// blue channel therefore carries a hash of the row, so distant rows are far apart
    /// in value and "no overlap" in a test means no overlap in the data.
    fn page(rows: u32) -> Vec<u8> {
        let mut rgba = Vec::with_capacity((WIDTH as usize) * (rows as usize) * 4);
        for row in 0..rows {
            // A cheap integer hash; the constants are arbitrary, only the scattering
            // matters.
            let hash = row
                .wrapping_mul(2_654_435_761)
                .rotate_left(13)
                .wrapping_mul(0x85eb_ca6b);
            for column in 0..WIDTH {
                let r = (row % 251) as u8;
                let g = ((row / 251) % 251) as u8;
                // Varies along the row as well, so the column buckets differ.
                let b = ((hash >> 8) as u8).wrapping_add((column * 3) as u8);
                rgba.extend_from_slice(&[r, g, b, 255]);
            }
        }
        rgba
    }

    /// A window onto the page, as a scroll frame would see it.
    fn window(page: &[u8], first_row: u32, rows: u32) -> Vec<u8> {
        let start = (first_row as usize) * (WIDTH as usize) * 4;
        let end = start + (rows as usize) * (WIDTH as usize) * 4;
        page[start..end].to_vec()
    }

    /// Reads back which source row a row of the result came from.
    fn row_identity(rgba: &[u8], row: u32) -> (u8, u8) {
        let pixel = (row as usize) * (WIDTH as usize) * 4;
        (rgba[pixel], rgba[pixel + 1])
    }

    /// The row number as `page` encodes it.
    fn expected_identity(source_row: u32) -> (u8, u8) {
        ((source_row % 251) as u8, ((source_row / 251) % 251) as u8)
    }

    fn stitcher(first: &[u8], rows: u32) -> Stitcher {
        Stitcher::new(
            StitchConfig::default(),
            WIDTH,
            rows,
            first.to_vec(),
            MAX_HEIGHT,
        )
        .expect("the first frame should be valid")
    }

    #[test]
    fn joins_two_frames_at_the_true_offset() {
        let page = page(400);
        let mut stitcher = stitcher(&window(&page, 0, 100), 100);

        // The view scrolled by 40 rows, so the frame starts at source row 40.
        let outcome = stitcher.offer(WIDTH, 100, &window(&page, 40, 100));

        match outcome {
            StitchOutcome::Accepted {
                offset,
                appended_rows,
                ..
            } => {
                // The confirmed tail is source rows 76..100, which sits at frame rows
                // 36..60.
                assert_eq!(offset, 36);
                assert_eq!(appended_rows, 40);
            }
            other => panic!("expected an accepted frame, got {other:?}"),
        }
        assert_eq!(stitcher.height(), 140);
    }

    #[test]
    fn the_result_is_the_source_rows_in_order_without_gaps_or_repeats() {
        // The property that matters is not "it looks similar" but "row n of the output
        // is row n of the page". A one-row error either way breaks this.
        let page = page(400);
        let mut stitcher = stitcher(&window(&page, 0, 100), 100);

        for step in 1..=5 {
            let outcome = stitcher.offer(WIDTH, 100, &window(&page, step * 40, 100));
            assert!(
                matches!(outcome, StitchOutcome::Accepted { .. }),
                "step {step} should be accepted, got {outcome:?}"
            );
        }

        assert_eq!(stitcher.height(), 300);
        for row in 0..300 {
            assert_eq!(
                row_identity(stitcher.confirmed(), row),
                expected_identity(row),
                "output row {row} should be source row {row}"
            );
        }
    }

    #[test]
    fn handles_a_scroll_of_a_single_row() {
        let page = page(400);
        let mut stitcher = stitcher(&window(&page, 0, 100), 100);

        let outcome = stitcher.offer(WIDTH, 100, &window(&page, 1, 100));

        match outcome {
            StitchOutcome::Accepted { appended_rows, .. } => assert_eq!(appended_rows, 1),
            other => panic!("expected an accepted frame, got {other:?}"),
        }
    }

    #[test]
    fn handles_a_scroll_that_leaves_the_minimum_overlap() {
        let page = page(400);
        let mut stitcher = stitcher(&window(&page, 0, 100), 100);

        // 76 rows of scroll puts the 24-row band exactly at the frame's top.
        let outcome = stitcher.offer(WIDTH, 100, &window(&page, 76, 100));

        match outcome {
            StitchOutcome::Accepted {
                offset,
                appended_rows,
                ..
            } => {
                assert_eq!(offset, 0);
                assert_eq!(appended_rows, 76);
            }
            other => panic!("expected an accepted frame, got {other:?}"),
        }
    }

    #[test]
    fn refuses_a_frame_with_no_overlap_at_all() {
        // §6.3: a jump past the overlap must not be guessed at. Silently dropping the
        // skipped rows would produce a file that looks continuous and is not.
        let page = page(400);
        let mut stitcher = stitcher(&window(&page, 0, 100), 100);

        let outcome = stitcher.offer(WIDTH, 100, &window(&page, 200, 100));

        assert!(
            matches!(
                outcome,
                StitchOutcome::Rejected(RejectReason::NoOverlap { .. })
            ),
            "expected a no-overlap rejection, got {outcome:?}"
        );
        assert_eq!(stitcher.height(), 100);
    }

    #[test]
    fn a_rejected_frame_leaves_the_confirmed_prefix_byte_identical() {
        // §6.4: the last confirmed pixel range is kept, and a pending frame never
        // sneaks into it.
        let page = page(400);
        let mut stitcher = stitcher(&window(&page, 0, 100), 100);
        let before = stitcher.confirmed().to_vec();

        stitcher.offer(WIDTH, 100, &window(&page, 300, 100));

        assert_eq!(stitcher.confirmed(), before.as_slice());
    }

    #[test]
    fn refuses_a_repeated_list_where_several_alignments_match_equally() {
        // §6.4 names this case. Identical repeating rows score well at every period
        // boundary, and picking one would be a coin flip that drops or duplicates whole
        // list items.
        let period = 8;
        let mut repeated = Vec::new();
        for row in 0..200u32 {
            for column in 0..WIDTH {
                let phase = row % period;
                let value = (phase * 30) as u8;
                repeated.extend_from_slice(&[value, value, ((column % 7) * 30) as u8, 255]);
            }
        }
        let mut stitcher = stitcher(&window(&repeated, 0, 100), 100);

        // A scroll by a whole number of periods: genuinely indistinguishable from
        // several other alignments.
        let outcome = stitcher.offer(WIDTH, 100, &window(&repeated, 40, 100));

        assert!(
            matches!(
                outcome,
                StitchOutcome::Rejected(RejectReason::Ambiguous { .. })
            ),
            "expected an ambiguity rejection, got {outcome:?}"
        );
    }

    #[test]
    fn refuses_a_blank_region_rather_than_trusting_a_perfect_score() {
        // §6.4: a monochrome area matches anywhere with score zero. A perfect score is
        // the least informative outcome here, and treating it as success would place
        // the seam arbitrarily.
        let blank = vec![250u8; (WIDTH as usize) * 200 * 4];
        let mut stitcher = stitcher(&blank[..(WIDTH as usize) * 100 * 4], 100);

        let outcome = stitcher.offer(WIDTH, 100, &blank[..(WIDTH as usize) * 100 * 4]);

        assert!(
            matches!(
                outcome,
                StitchOutcome::Rejected(RejectReason::LowInformation { .. })
            ),
            "expected a low-information rejection, got {outcome:?}"
        );
    }

    #[test]
    fn refuses_a_frame_that_did_not_move() {
        // §6.3: no new content may pause the capture, but it must not be reported as
        // having reached the bottom, and the same rows must not be appended twice.
        let page = page(400);
        let mut stitcher = stitcher(&window(&page, 0, 100), 100);

        let outcome = stitcher.offer(WIDTH, 100, &window(&page, 0, 100));

        assert_eq!(outcome, StitchOutcome::Rejected(RejectReason::NoNewContent));
        assert_eq!(stitcher.height(), 100);
    }

    #[test]
    fn refuses_a_frame_of_a_different_width() {
        let page = page(400);
        let mut stitcher = stitcher(&window(&page, 0, 100), 100);

        let outcome = stitcher.offer(WIDTH + 8, 100, &vec![0; ((WIDTH + 8) as usize) * 100 * 4]);

        assert_eq!(outcome, StitchOutcome::Rejected(RejectReason::SizeMismatch));
    }

    #[test]
    fn refuses_a_buffer_that_does_not_match_its_declared_size() {
        let page = page(400);
        let mut stitcher = stitcher(&window(&page, 0, 100), 100);

        let outcome = stitcher.offer(WIDTH, 100, &[0; 16]);

        assert_eq!(outcome, StitchOutcome::Rejected(RejectReason::SizeMismatch));
    }

    #[test]
    fn stops_at_the_capacity_limit_instead_of_growing_past_it() {
        // §6.4: the limit produces a partial result the user confirms, never a
        // truncated image presented as complete.
        let page = page(400);
        let mut stitcher = Stitcher::new(
            StitchConfig::default(),
            WIDTH,
            100,
            window(&page, 0, 100),
            120,
        )
        .expect("valid first frame");

        let outcome = stitcher.offer(WIDTH, 100, &window(&page, 40, 100));

        assert_eq!(
            outcome,
            StitchOutcome::Rejected(RejectReason::CapacityReached)
        );
        assert_eq!(stitcher.height(), 100);
    }

    #[test]
    fn keeps_a_fixed_header_once_instead_of_at_every_seam() {
        // §6.4: a fixed header appears at most once in the result, and must not match
        // the band wherever it happens to resemble it.
        let page = page(400);
        let header_rows = 12;
        let mut header = Vec::new();
        for row in 0..header_rows {
            for column in 0..WIDTH {
                header.extend_from_slice(&[9, 9, ((row * 5 + column) % 200) as u8, 255]);
            }
        }
        let framed = |first_row: u32, rows: u32| {
            let mut out = header.clone();
            out.extend_from_slice(&window(&page, first_row, rows - header_rows));
            out
        };

        let config = StitchConfig {
            exclude_top_rows: header_rows,
            ..StitchConfig::default()
        };
        let mut stitcher = Stitcher::new(config, WIDTH, 100, framed(0, 100), MAX_HEIGHT)
            .expect("valid first frame");

        let outcome = stitcher.offer(WIDTH, 100, &framed(40, 100));

        match outcome {
            StitchOutcome::Accepted { appended_rows, .. } => {
                assert_eq!(appended_rows, 40);
                for row in header_rows..stitcher.height() {
                    assert_ne!(
                        row_identity(stitcher.confirmed(), row),
                        (9, 9),
                        "the header must not reappear at row {row}"
                    );
                }
            }
            other => panic!("expected an accepted frame, got {other:?}"),
        }
    }

    #[test]
    fn drops_a_fixed_footer_rather_than_burying_it_mid_image() {
        // §6.4 allows a fixed footer at most once. Keeping the first frame's footer would
        // place it in the middle of the result once rows are appended below it, which is
        // a visible artefact in the file; at capture time there is no way to know which
        // frame is the last one, so the honest option is to exclude it.
        let page = page(400);
        let footer_rows = 10;
        let mut footer = Vec::new();
        for row in 0..footer_rows {
            for column in 0..WIDTH {
                footer.extend_from_slice(&[7, 7, ((row * 3 + column) % 200) as u8, 255]);
            }
        }
        let framed = |first_row: u32, rows: u32| {
            let mut out = window(&page, first_row, rows - footer_rows);
            out.extend_from_slice(&footer);
            out
        };

        let config = StitchConfig {
            exclude_bottom_rows: footer_rows,
            ..StitchConfig::default()
        };
        let mut stitcher = Stitcher::new(config, WIDTH, 100, framed(0, 100), MAX_HEIGHT)
            .expect("valid first frame");
        // The first frame's footer is trimmed straight away.
        assert_eq!(stitcher.height(), 90);

        let outcome = stitcher.offer(WIDTH, 100, &framed(40, 100));

        match outcome {
            StitchOutcome::Accepted { appended_rows, .. } => {
                // The appended rows stop before the footer.
                assert_eq!(appended_rows, 40);
                // The footer appears nowhere, and every row is real content in order.
                for row in 0..stitcher.height() {
                    assert_ne!(
                        row_identity(stitcher.confirmed(), row),
                        (7, 7),
                        "the footer must not appear at row {row}"
                    );
                    assert_eq!(
                        row_identity(stitcher.confirmed(), row),
                        expected_identity(row)
                    );
                }
            }
            other => panic!("expected an accepted frame, got {other:?}"),
        }
    }

    #[test]
    fn tolerates_a_scrollbar_thumb_that_moves_between_frames() {
        // A scrollbar occupies a narrow column range and changes every frame. §6.4
        // requires it not to break the match; dropping the worst column bucket absorbs
        // it without having to detect it first.
        let page = page(400);
        let with_scrollbar = |first_row: u32, thumb_at: u32| {
            let mut frame = window(&page, first_row, 100);
            for row in 0..100u32 {
                let bright = row >= thumb_at && row < thumb_at + 20;
                for column in (WIDTH - 6)..WIDTH {
                    let pixel = ((row as usize) * (WIDTH as usize) + column as usize) * 4;
                    let value = if bright { 240 } else { 40 };
                    frame[pixel] = value;
                    frame[pixel + 1] = value;
                    frame[pixel + 2] = value;
                }
            }
            frame
        };
        let mut stitcher = stitcher(&with_scrollbar(0, 0), 100);

        let outcome = stitcher.offer(WIDTH, 100, &with_scrollbar(40, 30));

        match outcome {
            StitchOutcome::Accepted { appended_rows, .. } => assert_eq!(appended_rows, 40),
            other => panic!("expected an accepted frame despite the scrollbar, got {other:?}"),
        }
    }

    #[test]
    fn refuses_a_frame_shorter_than_the_band() {
        let page = page(400);
        let mut stitcher = stitcher(&window(&page, 0, 100), 100);

        let outcome = stitcher.offer(WIDTH, 10, &window(&page, 40, 10));

        assert_eq!(
            outcome,
            StitchOutcome::Rejected(RejectReason::FrameTooShort)
        );
    }

    #[test]
    fn records_every_decision_in_order() {
        // §6.4 requires accept/reject reasons to be diagnosable, so they are retained
        // rather than only returned.
        let page = page(400);
        let mut stitcher = stitcher(&window(&page, 0, 100), 100);

        stitcher.offer(WIDTH, 100, &window(&page, 40, 100));
        stitcher.offer(WIDTH, 100, &window(&page, 300, 100));
        stitcher.offer(WIDTH, 100, &window(&page, 80, 100));

        assert_eq!(stitcher.log().len(), 3);
        assert!(matches!(stitcher.log()[0], StitchOutcome::Accepted { .. }));
        assert!(matches!(
            stitcher.log()[1],
            StitchOutcome::Rejected(RejectReason::NoOverlap { .. })
        ));
        assert!(matches!(stitcher.log()[2], StitchOutcome::Accepted { .. }));
    }

    #[test]
    fn reports_the_score_and_the_runner_up_for_an_accepted_frame() {
        // The numbers behind the decision, so a borderline accept can be examined
        // rather than taken on faith.
        let page = page(400);
        let mut stitcher = stitcher(&window(&page, 0, 100), 100);

        let outcome = stitcher.offer(WIDTH, 100, &window(&page, 40, 100));

        match outcome {
            StitchOutcome::Accepted {
                score,
                runner_up: Some(runner_up),
                ..
            } => {
                // An exact window of the same page matches perfectly.
                assert_eq!(score, 0);
                // And the next distinct alignment is clearly worse, which is why this
                // was accepted rather than called ambiguous.
                assert!(
                    runner_up >= StitchConfig::default().ambiguity_margin,
                    "runner-up {runner_up} should clear the margin"
                );
            }
            other => panic!("expected an accepted frame with diagnostics, got {other:?}"),
        }
    }

    #[test]
    fn continuing_after_a_rejection_still_lands_on_the_true_rows() {
        // §6.4: continuing must re-find the tail overlap rather than resuming from an
        // unknown position.
        let page = page(400);
        let mut stitcher = stitcher(&window(&page, 0, 100), 100);

        stitcher.offer(WIDTH, 100, &window(&page, 250, 100));
        let outcome = stitcher.offer(WIDTH, 100, &window(&page, 60, 100));

        assert!(matches!(outcome, StitchOutcome::Accepted { .. }));
        assert_eq!(stitcher.height(), 160);
        for row in 0..160 {
            assert_eq!(
                row_identity(stitcher.confirmed(), row),
                expected_identity(row)
            );
        }
    }

    #[test]
    fn rejects_a_first_frame_that_is_empty_or_mis_sized() {
        let config = StitchConfig::default();
        assert!(Stitcher::new(config, 0, 10, vec![], MAX_HEIGHT).is_none());
        assert!(Stitcher::new(config, 10, 0, vec![], MAX_HEIGHT).is_none());
        assert!(Stitcher::new(config, 10, 10, vec![0; 16], MAX_HEIGHT).is_none());
    }

    #[test]
    fn accepts_smoothly_varying_content_where_neighbouring_offsets_score_well() {
        // The case RUNNER_UP_EXCLUSION exists for. On a vertical gradient the offset one
        // row away scores almost as well as the true one, because the content genuinely
        // looks nearly the same there. Treating that near-tie as ambiguity would reject
        // every gradient, photo and block of anti-aliased text. The runner-up therefore
        // has to be a distinct alignment, not the neighbour of the winner.
        //
        // The slope is what makes the alignment recoverable: four rows away is clearly
        // worse, which is why this is accepted while a flat region is not.
        const ROWS: u32 = 60;
        let mut gradient = Vec::with_capacity((WIDTH as usize) * (ROWS as usize) * 4);
        for row in 0..ROWS {
            for column in 0..WIDTH {
                let value = (row * 3) as u8;
                gradient.extend_from_slice(&[
                    value,
                    value,
                    value.wrapping_add((column % 4) as u8),
                    255,
                ]);
            }
        }
        let window40 = |first: u32| {
            let start = (first as usize) * (WIDTH as usize) * 4;
            gradient[start..start + 40 * (WIDTH as usize) * 4].to_vec()
        };
        let mut stitcher =
            Stitcher::new(StitchConfig::default(), WIDTH, 40, window40(0), MAX_HEIGHT)
                .expect("valid first frame");

        let outcome = stitcher.offer(WIDTH, 40, &window40(8));

        match outcome {
            StitchOutcome::Accepted {
                offset,
                appended_rows,
                score,
                runner_up,
            } => {
                assert_eq!(offset, 8);
                assert_eq!(appended_rows, 8);
                assert_eq!(score, 0);
                // The distinct runner-up is four rows out at 3 units per row per
                // channel: 4 * 3 * 256 = 3072, which clears the 2048 margin. The
                // immediate neighbour would only be 768 and would not.
                assert_eq!(runner_up, Some(3072));
            }
            other => panic!("expected an accepted frame on a gradient, got {other:?}"),
        }
    }
}
