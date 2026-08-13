import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { entities } from './entities';

loadEnv({ path: '../.env', override: true });
loadEnv({ path: '.env', override: true });

console.log('DATABASE CONFIG:');
console.log('POSTGRES_HOST:', process.env.POSTGRES_HOST);
console.log('POSTGRES_PORT:', process.env.POSTGRES_PORT);
console.log('POSTGRES_USER:', process.env.POSTGRES_USER);
console.log('POSTGRES_DB:', process.env.POSTGRES_DB);

export default new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  username: process.env.POSTGRES_USER ?? 'adaptivehire',
  password: process.env.POSTGRES_PASSWORD ?? 'adaptivehire',
  database: process.env.POSTGRES_DB ?? 'adaptivehire',
  entities,
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
