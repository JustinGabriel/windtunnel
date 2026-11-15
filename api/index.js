// Vercel entry point: the whole Express app as one function. vercel.json rewrites
// every path that is not a static file in public/ to this handler.

import { createApp } from '../src/server/app.js';

export default createApp();
