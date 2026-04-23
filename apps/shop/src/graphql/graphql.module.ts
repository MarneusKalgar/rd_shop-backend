import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { Request, Response } from 'express';

import { OrdersModule } from '@/orders/orders.module';
import { ProductsModule } from '@/products/products.module';
import { UsersModule } from '@/users/users.module';
import { isProduction } from '@/utils';

import { OrderItemLoader, OrderLoader, ProductLoader, UserLoader } from './loaders';
import { OrdersResolver } from './resolvers';
import { OrderItemResolver } from './resolvers/order-item';

@Module({
  imports: [
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      useFactory: () => {
        const isProd = isProduction();

        return {
          autoSchemaFile: true,
          context: ({ req, res }: { req: Request; res: Response }) => ({ req, res }),
          driver: ApolloDriver,
          graphiql: !isProd,
          introspection: !isProd,
          path: '/graphql',
          sortSchema: true,
          stopOnTerminationSignals: false,
        };
      },
    }),
    UsersModule,
    OrdersModule,
    ProductsModule,
  ],
  providers: [
    OrdersResolver,
    OrderItemResolver,
    OrderLoader,
    OrderItemLoader,
    ProductLoader,
    UserLoader,
  ],
})
export class GraphqlModule {}
