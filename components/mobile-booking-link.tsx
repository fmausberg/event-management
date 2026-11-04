"use client";

export function MobileBookingLink() {
    return <div className="sticky top-0 z-20 border-b border-zinc-200 bg-white px-5 py-3 shadow-sm sm:px-8 lg:hidden">
        <a href="#event-booking" className="block w-full rounded-md bg-accent-500 px-5 py-3 text-center font-semibold text-zinc-950 hover:bg-accent-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600" onClick={event => {
            const booking = document.getElementById("event-booking");
            if (!booking) return;
            event.preventDefault();
            booking.focus({ preventScroll: true });
            booking.scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
                block: "start",
            });
        }}>Zur Buchung</a>
    </div>;
}
