import { anyApi, cronJobs } from 'convex/server';

const crons = cronJobs();

crons.interval('cleanup expired MeshMeet coordination data', { minutes: 2 }, anyApi.cleanup.run);

export default crons;
