import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';

import { OrdersModule } from '@/orders/orders.module';
import { UsersModule } from '@/users/users.module';

import { OrdersResolver, UsersResolver } from './resolvers';
import { OrderItemResolver } from './resolvers/order-item';

@Module({
  imports: [
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      useFactory: () => ({
        autoSchemaFile: true,
        driver: ApolloDriver,
        graphiql: true,
        introspection: true,
        path: '/graphql',
        sortSchema: true,
        stopOnTerminationSignals: false,
      }),
    }),
    UsersModule,
    OrdersModule,
  ],
  providers: [UsersResolver, OrdersResolver, OrderItemResolver],
})
export class GraphqlModule {}
