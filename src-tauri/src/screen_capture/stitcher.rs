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

/// The rightmost bucket is excluded from matching to tolerate a scrollbar.
/// Interior text remains evidence even when it occupies only one narrow column.
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
    Prepended { rows: u32, score: u32 },
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
    /// Spread of the band starting at each confirmed row, extended as rows are
    /// appended so no frame has to rescan the whole image.
    band_spreads: Vec<u32>,
    max_spread: u32,
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
        let mut stitcher = Self {
            config,
            width,
            confirmed: rgba,
            height: kept,
            signatures,
            band_spreads: Vec::new(),
            max_spread: 0,
            max_height,
            log: Vec::new(),
        };
        stitcher.extend_band_spreads();
        Some(stitcher)
    }

    fn extend_band_spreads(&mut self) {
        let band = self.config.band_rows;
        if self.height < band {
            return;
        }
        for start in self.band_spreads.len() as u32..=self.height - band {
            let spread = band_spread_at(&self.signatures, start, band);
            self.max_spread = self.max_spread.max(spread);
            self.band_spreads.push(spread);
        }
    }

    pub(crate) fn width(&self) -> u32 {
        self.width
    }

    pub(crate) fn height(&self) -> u32 {
        self.height
    }

    pub(crate) fn preview(&self, max_width: u32) -> (u32, u32, Vec<u8>) {
        let width = max_width.max(1).min(self.width);
        let height = (self.height as u64 * width as u64 / self.width as u64).max(1) as u32;
        let mut pixels = Vec::with_capacity(width as usize * height as usize * 4);
        for y in 0..height {
            let source_y = y as u64 * self.height as u64 / height as u64;
            for x in 0..width {
                let source_x = x as u64 * self.width as u64 / width as u64;
                let index = (source_y * self.width as u64 + source_x) as usize * 4;
                pixels.extend_from_slice(&self.confirmed[index..index + 4]);
            }
        }
        (width, height, pixels)
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
            let overlap = height - self.config.exclude_bottom_rows - offset - appended_rows;
            let start = ((offset + overlap) as usize) * (width as usize) * 4;
            let end = start + (appended_rows as usize) * (width as usize) * 4;
            self.confirmed.extend_from_slice(&rgba[start..end]);
            let appended_signatures =
                row_signatures_range(rgba, width, offset + overlap, appended_rows, self.config);
            self.signatures.extend_from_slice(&appended_signatures);
            self.height += appended_rows;
            self.extend_band_spreads();
        }
        let outcome = if matches!(outcome, StitchOutcome::Rejected(RejectReason::NoOverlap { .. })) {
            self.try_prepend(width, height, rgba).unwrap_or(outcome)
        } else {
            outcome
        };
        self.log.push(outcome);
        outcome
    }

    fn try_prepend(&mut self, width: u32, height: u32, rgba: &[u8]) -> Option<StitchOutcome> {
        if width != self.width || rgba.len() != width as usize * height as usize * 4
            || self.config.exclude_top_rows != 0 || self.config.exclude_bottom_rows != 0 {
            return None;
        }
        let minimum = self.config.min_overlap_rows.max(self.config.band_rows);
        if height <= minimum { return None; }
        let signatures = row_signatures(rgba, width, height, self.config);
        let mut matches = Vec::new();
        for rows in 1..=height - minimum {
            let overlap = (height - rows).min(self.height);
            let right = &signatures[rows as usize * BUCKETS * CHANNELS..];
            let score = band_score_bounded(&self.signatures, right, overlap, self.config.accept_score);
            if score <= self.config.accept_score
                && (0..=overlap - self.config.band_rows).any(|start| {
                    band_spread_at(&self.signatures, start, self.config.band_rows)
                        >= self.config.min_band_spread
                })
                && overlap_pixels_agree(&self.confirmed, rgba, width, 0, rows, overlap) {
                matches.push((rows, score));
            }
        }
        let &(rows, score) = matches.iter().min_by_key(|candidate| candidate.1)?;
        if matches.iter().any(|&(other, other_score)| {
            other.abs_diff(rows) > RUNNER_UP_EXCLUSION
                && other_score < score.saturating_add(self.config.ambiguity_margin)
        }) { return None; }
        if self.height.saturating_add(rows) > self.max_height {
            return Some(StitchOutcome::Rejected(RejectReason::CapacityReached));
        }
        let mut pixels = rgba[..rows as usize * width as usize * 4].to_vec();
        pixels.extend_from_slice(&self.confirmed);
        self.confirmed = pixels;
        let mut prefix = signatures[..rows as usize * BUCKETS * CHANNELS].to_vec();
        prefix.extend_from_slice(&self.signatures);
        self.signatures = prefix;
        self.height += rows;
        self.band_spreads.clear();
        self.max_spread = 0;
        self.extend_band_spreads();
        Some(StitchOutcome::Prepended { rows, score })
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
        let spread = self.max_spread;
        if spread < self.config.min_band_spread {
            return StitchOutcome::Rejected(RejectReason::LowInformation { spread });
        }

        let frame_signatures = row_signatures(rgba, width, height, self.config);
        let available = height - bottom;
        let min_overlap = self.config.min_overlap_rows.max(band);
        let mut candidates = Vec::new();
        let informative = |candidate: &(u32, u32, u32, u32)| {
            self.band_spreads[candidate.1 as usize..=(candidate.1 + candidate.2 - band) as usize]
                .iter()
                .any(|spread| *spread >= self.config.min_band_spread)
        };
        let reverse_candidate = |confirmed_start: u32, overlap: u32| {
            let left = &self.signatures[(confirmed_start as usize) * BUCKETS * CHANNELS..];
            let right = &frame_signatures[(top as usize) * BUCKETS * CHANNELS..];
            (top, confirmed_start, overlap, band_score(left, right, overlap))
        };

        // Compare the whole usable overlap, with a band only as the minimum anchor.
        // Forward candidates end at the confirmed tail; reverse candidates stay wholly
        // inside confirmed history and therefore never mutate it.
        for offset in top..=top + searchable - band {
            let max_overlap = available - offset;
            if max_overlap < min_overlap {
                continue;
            }
            let before = offset.saturating_sub(top).min(self.height - band);
            let forward_overlap = before + band;
            if forward_overlap >= min_overlap {
                let confirmed_start = self.height - band - before;
                let frame_start = offset - before;
                let left = &self.signatures[(confirmed_start as usize) * BUCKETS * CHANNELS..];
                let right = &frame_signatures[(frame_start as usize) * BUCKETS * CHANNELS..];
                candidates.push((
                    frame_start,
                    confirmed_start,
                    forward_overlap,
                    band_score_bounded(left, right, forward_overlap,
                        self.config.accept_score.saturating_add(self.config.ambiguity_margin)),
                ));
            }
        }
        let reverse_overlap = (available - top).min(self.height);
        let reverse = reverse_overlap >= min_overlap;
        if reverse {
            // The one reverse alignment that ends at the tail competes with the tail.
            candidates.push(reverse_candidate(self.height - reverse_overlap, reverse_overlap));
        }
        candidates.retain(|candidate| informative(candidate));
        let prefer_tail = candidates.iter().any(|candidate| {
            candidate.1 + candidate.2 == self.height && candidate.3 <= self.config.accept_score
        });
        // History is only consulted when the tail cannot explain the frame: with an
        // acceptable tail match, neither the pick nor the ambiguity check looks at
        // history. Skipping it keeps each frame's cost independent of the length.
        if reverse && !prefer_tail {
            candidates.extend(
                (0..self.height - reverse_overlap)
                    .map(|confirmed_start| reverse_candidate(confirmed_start, reverse_overlap))
                    .filter(|candidate| informative(candidate)),
            );
        }
        let tail_candidates: Vec<_> = candidates
            .iter()
            .filter(|candidate| candidate.1 + candidate.2 == self.height)
            .collect();
        let prefer_tail = tail_candidates
            .iter()
            .any(|candidate| candidate.3 <= self.config.accept_score);
        let pool = if prefer_tail {
            tail_candidates
        } else {
            candidates.iter().collect()
        };
        let Some(best) = pool
            .into_iter()
            .min_by_key(|candidate| (candidate.3, std::cmp::Reverse(candidate.2)))
            .copied()
        else {
            return StitchOutcome::Rejected(RejectReason::NoOverlap { best: u32::MAX });
        };
        if best.3 > self.config.accept_score {
            return StitchOutcome::Rejected(RejectReason::NoOverlap { best: best.3 });
        }
        let pixels_agree = |candidate: &(u32, u32, u32, u32)| {
            overlap_pixels_agree(&self.confirmed, rgba, width,
                candidate.1, candidate.0, candidate.2)
        };
        if !pixels_agree(&best) {
            return StitchOutcome::Rejected(RejectReason::NoOverlap { best: best.3 });
        }
        let distinct = |candidate: &&(u32, u32, u32, u32)| {
            (!prefer_tail || candidate.1 + candidate.2 == self.height)
                && (candidate.1 as i64 - candidate.0 as i64)
                    .abs_diff(best.1 as i64 - best.0 as i64)
                    > RUNNER_UP_EXCLUSION as u64
        };
        let runner_up = candidates
            .iter()
            .filter(distinct)
            .map(|candidate| candidate.3)
            .min();
        if let Some(runner_up) = runner_up {
            if runner_up < best.3.saturating_add(self.config.ambiguity_margin)
                && candidates.iter().filter(distinct).any(|candidate| {
                    candidate.3 < best.3.saturating_add(self.config.ambiguity_margin)
                        && pixels_agree(candidate)
                })
            {
                return StitchOutcome::Rejected(RejectReason::Ambiguous {
                    best: best.3,
                    runner_up,
                });
            }
        }

        // A short repeated tail must not outrank an exact full viewport revisit.
        // Anchor scoring rejects most history positions before pixel verification.
        if reverse && best.2 < reverse_overlap {
            for start in 0..self.height - reverse_overlap {
                let candidate = reverse_candidate(start, reverse_overlap);
                if candidate.3 <= self.config.accept_score && informative(&candidate)
                    && pixels_agree(&candidate) {
                    return StitchOutcome::Rejected(RejectReason::NoNewContent);
                }
            }
        }
        let ends_at_tail = best.1 + best.2 == self.height;
        let appended_rows = available - (best.0 + best.2);
        if !ends_at_tail || appended_rows == 0 {
            return StitchOutcome::Rejected(RejectReason::NoNewContent);
        }
        if self.height.saturating_add(appended_rows) > self.max_height {
            return StitchOutcome::Rejected(RejectReason::CapacityReached);
        }
        StitchOutcome::Accepted {
            offset: best.0 + best.2 - band,
            appended_rows,
            score: best.3,
            runner_up,
        }
    }
}

/// Pixel verification prevents bucket averages from hiding moving or changed text.
/// The rightmost bucket remains excluded for a scrollbar, as in signature scoring.
fn overlap_pixels_agree(
    confirmed: &[u8], frame: &[u8], width: u32,
    confirmed_start: u32, frame_start: u32, rows: u32,
) -> bool {
    let columns = (width as usize * (BUCKETS - TRIMMED_BUCKETS)) / BUCKETS;
    let stride = width as usize * 4;
    let budget = (columns * rows as usize / 2000).min(64);
    let mut changed = 0;
    for row in 0..rows as usize {
        let left = (confirmed_start as usize + row) * stride;
        let right = (frame_start as usize + row) * stride;
        if confirmed[left..left + columns * 4] == frame[right..right + columns * 4] {
            continue;
        }
        for column in 0..columns {
            let a = left + column * 4;
            let b = right + column * 4;
            if (0..3).any(|channel| confirmed[a + channel].abs_diff(frame[b + channel]) > 3) {
                changed += 1;
                if changed > budget {
                    return false;
                }
            }
        }
    }
    true
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
    band_score_bounded(left, right, rows, u32::MAX)
}

fn band_score_bounded(left: &[u32], right: &[u32], rows: u32, cutoff: u32) -> u32 {
    let maximum = cutoff as u64 * rows as u64 * (BUCKETS - TRIMMED_BUCKETS) as u64 * CHANNELS as u64;
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
        // Only the right edge may be discarded as scrollbar evidence. Discarding
        // whichever bucket differs most also discards all text in a narrow left
        // column, making distinct text rows look like identical blank backgrounds.
        for value in per_bucket.iter().take(BUCKETS - TRIMMED_BUCKETS) {
            total += value;
            counted += CHANNELS as u64;
        }
        if total > maximum { return cutoff.saturating_add(1); }
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
fn band_spread_at(signatures: &[u32], start_row: u32, band: u32) -> u32 {
    let start = (start_row as usize) * BUCKETS * CHANNELS;
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
    fn reverse_history_does_not_mutate_then_forward_scroll_appends() {
        let page = page(400);
        let mut stitcher = stitcher(&window(&page, 0, 100), 100);
        assert!(matches!(
            stitcher.offer(WIDTH, 100, &window(&page, 40, 100)),
            StitchOutcome::Accepted {
                appended_rows: 40,
                ..
            }
        ));
        let before = stitcher.confirmed().to_vec();
        assert_eq!(
            stitcher.offer(WIDTH, 100, &window(&page, 20, 100)),
            StitchOutcome::Rejected(RejectReason::NoNewContent)
        );
        assert_eq!(stitcher.confirmed(), before.as_slice());
        assert!(matches!(
            stitcher.offer(WIDTH, 100, &window(&page, 80, 100)),
            StitchOutcome::Accepted {
                appended_rows: 40,
                ..
            }
        ));
        assert_eq!(stitcher.height(), 180);
    }

    #[test]
    fn structured_history_allows_a_whitespace_tail_overlap() {
        let mut page = page(220);
        for row in 100..220 {
            let start = row as usize * WIDTH as usize * 4;
            page[start..start + WIDTH as usize * 4].fill(255);
        }
        let mut stitcher = stitcher(&window(&page, 0, 100), 100);
        let outcome = stitcher.offer(WIDTH, 100, &window(&page, 40, 100));
        assert!(matches!(outcome, StitchOutcome::Accepted { .. }));
    }

    fn text_blocks(rows: u32, repeated: bool) -> Vec<u8> {
        let width = 600usize;
        let mut pixels = vec![255; width * rows as usize * 4];
        for row in 0..rows as usize {
            let line = row / 60;
            let phase = row % 60;
            let background = if repeated { 245 } else { 230 + (line % 4) as u8 * 6 };
            for column in 0..width {
                let index = (row * width + column) * 4;
                let glyph = phase >= 8 && phase < 20 && column < 68
                    && column % 9 < 5
                    && (column / 9 + phase + if repeated { 0 } else { line * 3 }) % 7 < 4;
                let value = if glyph { 35 } else { background };
                pixels[index..index + 4].copy_from_slice(&[value, value, value, 255]);
            }
        }
        pixels
    }

    #[test]
    fn colored_text_blocks_with_blank_tail_match_full_support() {
        let page = text_blocks(900, false);
        let frame = |start: usize| page[start * 600 * 4..(start + 400) * 600 * 4].to_vec();
        let first = frame(0);
        let mut stitcher = Stitcher::new(StitchConfig::default(), 600, 400,
            first, 1200).unwrap();
        let started = std::time::Instant::now();
        let outcome = stitcher.offer(600, 400, &frame(180));
        eprintln!("600x400 text-block match: {:?}", started.elapsed());
        assert!(matches!(outcome, StitchOutcome::Accepted { appended_rows: 180, .. }),
            "{outcome:?}");
        assert_eq!(stitcher.confirmed(), &page[..580 * 600 * 4]);
    }

    #[test]
    fn repeated_text_blocks_still_reject_ambiguous_displacements() {
        let page = text_blocks(900, true);
        let frame = |start: usize| page[start * 600 * 4..(start + 400) * 600 * 4].to_vec();
        let mut stitcher = Stitcher::new(StitchConfig::default(), 600, 400,
            frame(0), 1200).unwrap();
        let before = stitcher.confirmed().to_vec();
        assert!(matches!(stitcher.offer(600, 400, &frame(180)),
            StitchOutcome::Rejected(RejectReason::Ambiguous { .. })));
        assert_eq!(stitcher.confirmed(), before.as_slice());
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
