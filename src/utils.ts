import { CalendarEventRecord, ScheduleItem } from "./types";
import { DateRange } from "./schedule_provider";

export function getTodayWindow(nowMs = Date.now(), tzOffsetHours = 7): DateRange {
    const offsetMs = tzOffsetHours * 60 * 60 * 1000;
    const localNow = new Date(nowMs + offsetMs);
    const startOfDay =
        new Date(
            Date.UTC(
                localNow.getUTCFullYear(),
                localNow.getUTCMonth(),
                localNow.getUTCDate(),
                0, 0, 0, 0
            )
        ).getTime() - offsetMs;
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1;

    return { start: startOfDay, end: endOfDay };
}

export function computeVersionHash(events: CalendarEventRecord[]): string {
    const active = events
        .filter(e => e.status !== "cancelled")
        .sort((a, b) => a.start_time - b.start_time);
    if (active.length === 0) return "empty000";

    const raw = active
        .map(e => `${e.id}|${e.start_time}|${e.end_time}|${e.title}|${e.location}`)
        .join(";");

    let hash = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
        hash ^= raw.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}

export function toCompactSchedule(events: CalendarEventRecord[], leadTimeSec = 0): ScheduleItem[] {
    return events
        .filter(e => e.status !== "cancelled")
        .sort((a, b) => a.start_time - b.start_time)
        .map(e => {
            const startSec = Math.floor(e.start_time / 1000);
            return {
                remind_ts: Math.max(0, startSec - leadTimeSec),
                start_ts: startSec
            };
        });
}

export function getPollIntervalSec(nowMs = Date.now(), tzOffsetHours = 7): number {
    const localNow = new Date(nowMs + tzOffsetHours * 3600 * 1000);
    const hour = localNow.getUTCHours();
    if (hour >= 6 && hour < 22) return 1800;

    const target = new Date(localNow.getTime());
    if (hour >= 22) target.setUTCDate(target.getUTCDate() + 1);
    target.setUTCHours(6, 0, 0, 0);
    return Math.max(60, Math.floor((target.getTime() - localNow.getTime()) / 1000));
}
