import type { Event } from "@prisma/client";

const events: Event[] = [
    {
        id: "1",
        number: 1,
        name: "Summer Music Festival",
        Begin: new Date("2026-07-10T18:00"),
        End: new Date("2026-07-10T23:30"),
        maxSeats: 500,
    },
    {
        id: "2",
        number: 2,
        name: "Tech Conference 2026",
        Begin: new Date("2026-09-22T09:00"),
        End: new Date("2026-09-23T17:00"),
        maxSeats: 1200,
    },
    {
        id: "3",
        number: 3,
        name: "Local Art Exhibition",
        Begin: new Date("2026-10-05T10:00"),
        End: new Date("2026-10-05T18:00"),
        maxSeats: 150,
    },
];

function formatDateTime(value: Date) {
    return value.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

export default function EventsPage() {
    return (
        <div className="flex flex-1 flex-col bg-zinc-50 px-16 py-12 dark:bg-black">
            <h1 className="mb-6 text-2xl font-semibold text-black dark:text-zinc-50">
                Events
            </h1>
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-sm">
                    <thead className="bg-zinc-100 dark:bg-zinc-900">
                        <tr>
                            <th className="px-4 py-3 font-medium text-zinc-600 dark:text-zinc-400">
                                ID
                            </th>
                            <th className="px-4 py-3 font-medium text-zinc-600 dark:text-zinc-400">
                                Name
                            </th>
                            <th className="px-4 py-3 font-medium text-zinc-600 dark:text-zinc-400">
                                Start
                            </th>
                            <th className="px-4 py-3 font-medium text-zinc-600 dark:text-zinc-400">
                                End
                            </th>
                            <th className="px-4 py-3 font-medium text-zinc-600 dark:text-zinc-400">
                                Ticket Contingent
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {events.map((event) => (
                            <tr
                                key={event.id}
                                className="border-t border-zinc-200 dark:border-zinc-800"
                            >
                                <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                                    {event.number}
                                </td>
                                <td className="px-4 py-3 text-black dark:text-zinc-50">
                                    {event.name}
                                </td>
                                <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                                    {formatDateTime(event.Begin)}
                                </td>
                                <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                                    {formatDateTime(event.End)}
                                </td>
                                <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                                    {event.maxSeats}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
