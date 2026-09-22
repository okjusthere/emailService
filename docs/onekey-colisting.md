# Co-listing data retention

2026-09-21. Preserve BBO's six optional co-listing agent/office fields across
normalization, indexed reads from sourceSnapshot, imported sourceFacts, and
listing-search responses. Search results identify the co-listing agent
separately. The existing sourceSnapshot JSON already stores these facts, so no
schema migration is needed. Legacy cached rows remain valid but will not gain
missing facts until refreshed from BBO.

Sender signatures/reply routing remain tied to the explicitly selected primary
agent; storing a co-agent is not consent to change the sender or send messages.

Validation uses an isolated Prisma Client generated from this branch's schema;
reusing the active workspace's generated client was incompatible with its
SenderProfile.dailyLimit type. This was an environment mismatch, not a delivery
logic change. TypeScript, changed-file lint, all 102 unit tests and client/server builds
were run without production credentials or external delivery.
