export interface Env {
    AI?: any;
    WEBHOOK_SECRET_TOKEN: string;
    DEVICE_AUTH_TOKEN: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    GOOGLE_REFRESH_TOKEN: string;
}

export interface CalendarEventRecord {
    id: string;
    title: string;
    description: string;
    location: string;
    start_time: number;
    end_time: number;
    is_all_day: number;
    status: string;
    updated_at: number;
}

export interface ScheduleItem {
    remind_ts: number;
    start_ts: number;
}
