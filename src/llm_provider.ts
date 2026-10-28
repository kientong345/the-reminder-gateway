import { CalendarEventRecord, Env } from "./types";

const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";

export interface LLMProvider {
    formatReminderSpeech(events: CalendarEventRecord[], mode: "next" | "list"): Promise<string>;
}

function formatVnTime(tsMs: number): string {
    const vnDate = new Date(tsMs + 7 * 3600 * 1000);
    const hh = vnDate.getUTCHours();
    const mm = vnDate.getUTCMinutes();
    return mm === 0 ? `${hh} giờ` : `${hh} giờ ${mm} phút`;
}

function describeEvent(ev: CalendarEventRecord): string {
    const time = ev.is_all_day === 1 ? "cả ngày" : `lúc ${formatVnTime(ev.start_time)}`;
    const loc = ev.location?.trim() ? ` tại ${ev.location.trim()}` : "";
    const desc = ev.description?.trim() ? ` (${ev.description.trim()})` : "";
    return `${ev.title} ${time}${loc}${desc}`;
}

export class WorkersAILLMProvider implements LLMProvider {
    private ai: any;

    constructor(ai: any) {
        this.ai = ai;
    }

    async formatReminderSpeech(events: CalendarEventRecord[], mode: "next" | "list"): Promise<string> {
        if (events.length === 0) {
            return mode === "next"
                ? "Tuyệt vời, bạn không còn sự kiện nào sắp tới trong ngày hôm nay."
                : "Trong khoảng thời gian này bạn không có sự kiện nào trong lịch trình.";
        }

        const rawSummary = events.map((e, i) => `${i + 1}. ${describeEvent(e)}`).join("\n");
        const fallback = mode === "next"
            ? `Sự kiện tiếp theo của bạn là ${describeEvent(events[0])}.`
            : `Bạn có ${events.length} sự kiện: ${events.map(describeEvent).join("; ")}.`;

        if (!this.ai || typeof this.ai.run !== "function") return fallback;

        const systemPrompt =
            "Bạn là trợ lý giọng nói nhắc lịch trình bằng tiếng Việt tự nhiên, ngắn gọn, thân thiện để đọc qua loa. " +
            "TUYỆT ĐỐI KHÔNG dùng ký tự markdown (*, #, -, `), không xuống dòng, không thêm lời chào rườm rà. Chỉ trả về đúng câu lời nhắc.";
        const userPrompt = mode === "next"
            ? `Hãy chuyển sự kiện sắp tới này thành 1-2 câu lời nhắc tự nhiên bằng tiếng Việt:\n${rawSummary}`
            : `Hãy tổng hợp danh sách ${events.length} sự kiện sau thành một bản điểm tin ngắn gọn, mạch lạc bằng tiếng Việt:\n${rawSummary}`;

        try {
            const res = await this.ai.run(AI_MODEL, {
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                max_tokens: 256,
                temperature: 0.3
            });
            const text = (res?.response || "").replace(/[*#_`~>-]/g, " ").replace(/\s+/g, " ").trim();
            return text || fallback;
        } catch (err) {
            console.warn("[AI] Fallback to template:", err);
            return fallback;
        }
    }
}

export function createLLMProvider(env: Env): LLMProvider {
    return new WorkersAILLMProvider(env.AI);
}
