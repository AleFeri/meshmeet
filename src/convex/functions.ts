import {
	actionGeneric,
	internalMutationGeneric,
	mutationGeneric,
	queryGeneric,
	type ActionBuilder,
	type DataModelFromSchemaDefinition,
	type MutationBuilder,
	type QueryBuilder
} from 'convex/server';
import schema from './schema.js';

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;

export const query = queryGeneric as QueryBuilder<DataModel, 'public'>;
export const mutation = mutationGeneric as MutationBuilder<DataModel, 'public'>;
export const internalMutation = internalMutationGeneric as MutationBuilder<DataModel, 'internal'>;
export const action = actionGeneric as ActionBuilder<DataModel, 'public'>;
