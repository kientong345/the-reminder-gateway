export interface TTSProvider {
    synthesize(text: string, lang?: string): Promise<Uint8Array>;
}

export class GoogleTranslateTTSAdapter implements TTSProvider {
    async synthesize(text: string, lang = "vi"): Promise<Uint8Array> {
        const trimmed = text.trim();
        if (!trimmed) return new Uint8Array(0);

        const chunks: string[] = [];
        let current = "";
        for (const word of trimmed.split(/\s+/)) {
            if (!word) continue;
            if (current.length + word.length + 1 <= 180) {
                current = current ? `${current} ${word}` : word;
            } else {
                if (current) chunks.push(current);
                current = word;
            }
        }
        if (current) chunks.push(current);

        const buffers: Uint8Array[] = [];
        let totalLength = 0;
        for (const chunk of chunks) {
            const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
            const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
            if (!res.ok) throw new Error(`TTS failed with status ${res.status}`);
            const buf = new Uint8Array(await res.arrayBuffer());
            buffers.push(buf);
            totalLength += buf.byteLength;
        }

        const merged = new Uint8Array(totalLength);
        let offset = 0;
        for (const b of buffers) {
            merged.set(b, offset);
            offset += b.byteLength;
        }
        return merged;
    }
}

export function createTTSProvider(): TTSProvider {
    return new GoogleTranslateTTSAdapter();
}
