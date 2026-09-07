"""Align stored historical labels and clocks with current source parsing."""
import pandas as pd
import ingest_cfb
import tendency


def align(frame, league):
    frame = frame.copy()
    label_changes = 0
    if league == 'cfb':
        categories = pd.Series([ingest_cfb.classify(t, text if isinstance(text, str) else None)[0]
                                for t, text in zip(frame.play_type_raw, frame.play_text)], index=frame.index)
        label_changes = int(((frame.is_pass != categories.eq('pass')) | (frame.is_rush != categories.eq('rush')) |
                             (frame.is_penalty_only != categories.eq('penalty'))).sum())
        frame['is_pass'], frame['is_rush'] = categories.eq('pass'), categories.eq('rush')
        frame['is_special'], frame['is_penalty_only'] = categories.eq('special'), categories.eq('penalty')
    reported = frame.play_text.map(ingest_cfb.text_clock)
    eligible = tendency.eligible(frame).index
    old = frame.clock_seconds.copy()
    changed = reported.notna() & old.ne(reported)
    phase_change = changed & (((frame.period == 4) & ((old.le(120) != reported.le(120)) | (old.le(300) != reported.le(300)))) |
                              ((frame.period == 2) & (old.le(120) != reported.le(120))))
    clock_audit = {'eligibleWithExplicitSnapClock': int(reported.loc[eligible].notna().sum()),
                   'eligibleClocksDiffer': int(changed.loc[eligible].sum()),
                   'eligiblePhaseChanges': int(phase_change.loc[eligible].sum()),
                   'fallback': 'Structured source clock when the report has no explicit leading snap time; exact snap semantics are not independently verified.'}
    if league == 'cfb':
        frame.loc[reported.notna(), 'clock_seconds'] = reported[reported.notna()].astype('Int16')
    return frame, {'sourceLabelCorrections': label_changes, 'clockAudit': clock_audit}
