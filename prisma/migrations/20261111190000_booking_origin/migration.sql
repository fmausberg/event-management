CREATE TYPE "BookingOrigin" AS ENUM ('PLATFORM', 'MANUAL');

-- Leave historic bookings unknown rather than guessing their origin.
ALTER TABLE "Booking" ADD COLUMN "origin" "BookingOrigin";
