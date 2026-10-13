"use client";
import { useEffect, useRef, useState } from "react";
import type QrScanner from "qr-scanner";
import { inspectTicket, redeemTicket, type ScanResult } from "./actions";

export function TicketScanner() {
 const video = useRef<HTMLVideoElement>(null);
 const scanner = useRef<QrScanner | null>(null);
 const mounted = useRef(false);
 const busy = useRef(false);
 const [running, setRunning] = useState(false);
 const [pending, setPending] = useState(false);
 const [token, setToken] = useState("");
 const [manual, setManual] = useState("");
 const [result, setResult] = useState<ScanResult>({});
 useEffect(() => {
  mounted.current = true;
  return () => { mounted.current = false; scanner.current?.destroy(); scanner.current = null; };
 }, []);
 function stop() { scanner.current?.stop(); setRunning(false); }
 async function inspect(value: string) {
  if (busy.current) return;
  busy.current = true; setPending(true); stop(); setResult({}); setToken("");
  try {
   const data = await inspectTicket(value);
   if (mounted.current) { setResult(data); if (data.ticket) setToken(value); }
  } catch { if (mounted.current) setResult({ message: "Prüfung fehlgeschlagen. Bitte erneut scannen." }); }
  finally { busy.current = false; if (mounted.current) setPending(false); }
 }
 async function start() {
  if (busy.current) return;
  busy.current = true; setPending(true); setResult({}); setToken("");
  try {
   if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("CAMERA");
   const { default: Scanner } = await import("qr-scanner");
   if (!mounted.current || !video.current) return;
   scanner.current?.destroy();
   const instance = new Scanner(video.current, ({ data }) => { void inspect(data); }, { preferredCamera: "environment", returnDetailedScanResult: true, maxScansPerSecond: 5 });
   scanner.current = instance;
   await instance.start();
   if (!mounted.current) { instance.destroy(); return; }
   setRunning(true);
  } catch { scanner.current?.destroy(); scanner.current = null; if (mounted.current) setResult({ message: "Kamera nicht verfügbar. Bitte erlaube den Kamerazugriff und verwende HTTPS (lokal localhost). Alternativ kannst du den Ticket-Token eingeben." }); }
  finally { busy.current = false; if (mounted.current) setPending(false); }
 }
 async function redeem() {
  if (busy.current || !token) return;
  busy.current = true; setPending(true);
  try { setResult(await redeemTicket(token)); }
  catch { setResult({ message: "Keine Bestätigung erhalten. Bitte erneut scannen und den Status prüfen." }); }
  finally { busy.current = false; setPending(false); }
 }
 const date = (value: string) => new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(value));
 const button = "rounded-lg bg-primary-600 px-4 py-2 text-white disabled:opacity-50";
 return <main className="mx-auto w-full max-w-2xl p-6 sm:p-10">
  <h1 className="text-2xl font-semibold">Tickets scannen</h1>
  <p className="mt-2 text-sm text-zinc-500">Scanne den QR-Code eines Tickets. Erst der Button „Einlösen“ bestätigt den Eintritt.</p>
  <video ref={video} muted playsInline aria-label="Kameravorschau zum Scannen" className={`mt-6 aspect-video w-full rounded-xl bg-black object-cover ${running ? "" : "hidden"}`} />
  <div className="mt-5 flex gap-3"><button type="button" disabled={pending || running} onClick={() => void start()} className={button}>{result.ticket ? "Nächstes Ticket scannen" : "Kamera starten"}</button>{running && <button type="button" onClick={stop} className="underline">Kamera stoppen</button>}</div>
  <details className="mt-5 text-sm"><summary className="cursor-pointer">Token manuell eingeben</summary><form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void inspect(manual.trim()); }}><input aria-label="Ticket-Token" required maxLength={43} autoComplete="off" value={manual} onChange={(event) => setManual(event.target.value)} className="min-w-0 flex-1 rounded border p-2" /><button disabled={pending} className={button}>Prüfen</button></form></details>
  {pending && <p role="status" className="mt-5">Wird verarbeitet …</p>}
  {result.message && <p role="status" className="mt-5 rounded-lg bg-zinc-100 p-4 text-zinc-900">{result.message}</p>}
  {result.ticket && <section className="mt-5 rounded-xl border border-zinc-200 p-6">
   <h2 className="text-xl font-semibold">Ticket #{result.ticket.number}</h2><p className="mt-3 font-medium">{result.ticket.eventName}</p><p>{date(result.ticket.beginsAt)} Uhr (Berlin)</p>{result.ticket.venue && <p>{result.ticket.venue}</p>}
   <p className="mt-4"><span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${result.ticket.status === "Gültig" ? "bg-green-100 text-green-800" : result.ticket.status === "Storniert" ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800"}`}>{result.ticket.status}</span></p>{result.ticket.checkedInAt && <p>Eingelöst: {date(result.ticket.checkedInAt)}</p>}
   {result.ticket.canRedeem && <button type="button" disabled={pending} onClick={() => void redeem()} className={`${button} mt-5`}>Einlösen</button>}
  </section>}
 </main>;
}
