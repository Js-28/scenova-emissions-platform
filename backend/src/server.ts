import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { pool } from './config/db';
import tenantRoutes from './routes/tenantRoutes';
import activityRoutes from './routes/activityRoutes';
import rollupRoutes from './routes/rollupRoutes';
import assumptionsRoutes from './routes/assumptionsRoutes';

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: 'text/csv', limit: '2mb' }));
app.use('/api/tenant', tenantRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/rollup', rollupRoutes);
app.use('/api/assumptions', assumptionsRoutes);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');

    res.status(200).json({
      status: 'healthy',
      database: 'connected',
      environment: env.NODE_ENV,
    });
  } catch (error) {
    console.error(
      'Health check failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );

    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
    });
  }
});

const server = app.listen(env.PORT, () => {
  console.log(`Scenova API running on port ${env.PORT}`);
});

// Gracefully close database connections when the process stops.
async function shutdown(): Promise<void> {
  console.log('Shutting down Scenova API...');

  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', () => {
  void shutdown();
});

process.on('SIGINT', () => {
  void shutdown();
});