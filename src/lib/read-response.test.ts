import {afterEach, expect, it, vi} from "vitest";
import {readText} from "./bulk";
import {readNpiResponse} from "./read-response";

afterEach(() => vi.useRealTimers());
it("bounds stalled bodies without awaiting stalled cancellation", async () => {
  vi.useFakeTimers();
  const response = new Response(new ReadableStream({pull: () => new Promise(() => {}), cancel: () => new Promise(() => {})}));
  const result = expect(readNpiResponse(response)).rejects.toMatchObject({status: 504});
  await vi.advanceTimersByTimeAsync(15001);await result;
});
it.each([200, 206])("rejects partial HTTP %s and preserves the received evidence", async status => {
  await expect(readText(new Response("[]", {status, headers: {"content-range": "bytes 0-1/50"}}), 1024))
    .rejects.toMatchObject({status: 502, data: {response: "[]", http_status: status, incomplete: true}});
});
it("counts UTF-8 bytes and rejects malformed UTF-8", async () => {
  await expect(readText(new Response("α".repeat(8)), 15)).rejects.toThrow("byte limit");
  await expect(readNpiResponse(new Response(new Uint8Array([0xc3, 0x28])))).rejects.toThrow();
});
