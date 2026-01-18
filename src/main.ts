import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getEnvVariable } from './core/environment';
// import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // const configService = app.get(ConfigService);
  const port = getEnvVariable(app, 'PORT');
  console.log(`Application is running on port: ${port}`);
  await app.listen(port);
}
bootstrap();
