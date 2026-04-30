declare module "ws" {
  export class WebSocket {
    static readonly OPEN: number;
    static readonly CONNECTING: number;
    readyState: number;
    constructor(url: string);
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    send(data: any): void;
    close(): void;
  }
}
