import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const publicUserSelect = {
    id: true,
    name: true,
    email: true,
    role: true,
} satisfies Prisma.UserSelect;

const storeInclude = {
    manager: { select: publicUserSelect },
    sellers: {
        orderBy: { assignedAt: "desc" },
        select: {
            assignedAt: true,
            seller: { select: publicUserSelect },
        },
    },
} satisfies Prisma.StoreInclude;

type StoreWithRelations = Prisma.StoreGetPayload<{
    include: typeof storeInclude;
}>;

type StoreParams = {
    storeId: string;
};

type StoreSellerParams = StoreParams & {
    sellerId: string;
};

type CreateStoreBody = {
    name: string;
    description?: string | null;
    city?: string | null;
    commissionRate?: number;
    active?: boolean;
};

type UpdateStoreBody = Partial<CreateStoreBody>;

type AddSellerBody = {
    sellerId: string;
};

const createStoreSchema = {
    body: {
        type: "object",
        required: ["name"],
        properties: {
            name: { type: "string", minLength: 1 },
            description: { type: ["string", "null"] },
            city: { type: ["string", "null"] },
            commissionRate: { type: "number", minimum: 0, maximum: 100 },
            active: { type: "boolean" },
        },
    },
};

const updateStoreSchema = {
    params: {
        type: "object",
        required: ["storeId"],
        properties: {
            storeId: { type: "string", minLength: 1 },
        },
    },
    body: {
        type: "object",
        minProperties: 1,
        properties: {
            name: { type: "string", minLength: 1 },
            description: { type: ["string", "null"] },
            city: { type: ["string", "null"] },
            commissionRate: { type: "number", minimum: 0, maximum: 100 },
            active: { type: "boolean" },
        },
    },
};

const storeParamsSchema = {
    params: {
        type: "object",
        required: ["storeId"],
        properties: {
            storeId: { type: "string", minLength: 1 },
        },
    },
};

const addSellerSchema = {
    params: storeParamsSchema.params,
    body: {
        type: "object",
        required: ["sellerId"],
        properties: {
            sellerId: { type: "string", minLength: 1 },
        },
    },
};

const removeSellerSchema = {
    params: {
        type: "object",
        required: ["storeId", "sellerId"],
        properties: {
            storeId: { type: "string", minLength: 1 },
            sellerId: { type: "string", minLength: 1 },
        },
    },
};

function cleanText(value: string) {
    return value.trim();
}

function cleanOptionalText(value: string | null | undefined) {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    const cleanedValue = value.trim();
    return cleanedValue.length > 0 ? cleanedValue : null;
}

function serializeStore(store: StoreWithRelations) {
    return {
        id: store.id,
        name: store.name,
        description: store.description,
        city: store.city,
        commissionRate: store.commissionRate,
        active: store.active,
        manager: store.manager,
        sellers: store.sellers.map(({ assignedAt, seller }) => ({
            assignedAt,
            ...seller,
        })),
        createdAt: store.createdAt,
        updatedAt: store.updatedAt,
    };
}

function getAuthenticatedUserId(request: FastifyRequest) {
    return request.user.id ?? request.user.sub;
}

async function ensureCanManageStore(
    request: FastifyRequest,
    reply: FastifyReply,
    storeId: string,
) {
    const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { id: true, managerId: true },
    });

    if (!store) {
        reply.status(404).send({ error: "Loja não encontrada" });
        return null;
    }

    if (
        request.user.role !== "master" &&
        store.managerId !== getAuthenticatedUserId(request)
    ) {
        reply
            .status(403)
            .send({ error: "Você não pode gerenciar esta loja" });
        return null;
    }

    return store;
}

function canViewStore(request: FastifyRequest, store: StoreWithRelations) {
    const userId = getAuthenticatedUserId(request);

    if (request.user.role === "master" || store.manager.id === userId) {
        return true;
    }

    return store.sellers.some((seller) => seller.seller.id === userId);
}

export function registerStoreRoutes(app: FastifyInstance) {
    app.register(
        async (storeRoutes) => {
            storeRoutes.get(
                "/",
                { preHandler: [app.authenticate] },
                async (request) => {
                    const userId = getAuthenticatedUserId(request);
                    const where =
                        request.user.role === "master"
                            ? {}
                            : request.user.role === "gestor"
                              ? { managerId: userId }
                              : {
                                    sellers: {
                                        some: { sellerId: userId },
                                    },
                                };

                    const stores = await prisma.store.findMany({
                        where,
                        include: storeInclude,
                        orderBy: { createdAt: "desc" },
                    });

                    return stores.map(serializeStore);
                },
            );

            storeRoutes.get(
                "/:storeId",
                {
                    preHandler: [app.authenticate],
                    schema: storeParamsSchema,
                },
                async (request, reply) => {
                    const { storeId } = request.params as StoreParams;
                    const store = await prisma.store.findUnique({
                        where: { id: storeId },
                        include: storeInclude,
                    });

                    if (!store) {
                        return reply
                            .status(404)
                            .send({ error: "Loja não encontrada" });
                    }

                    if (!canViewStore(request, store)) {
                        return reply
                            .status(403)
                            .send({ error: "Você não pode visualizar esta loja" });
                    }

                    return serializeStore(store);
                },
            );

            storeRoutes.post(
                "/",
                {
                    preHandler: [app.authorize(["gestor", "master"])],
                    schema: createStoreSchema,
                },
                async (request, reply) => {
                    const body = request.body as CreateStoreBody;
                    const name = cleanText(body.name);

                    if (!name) {
                        return reply
                            .status(400)
                            .send({ error: "Nome da loja é obrigatório" });
                    }

                    const store = await prisma.store.create({
                        data: {
                            name,
                            description: cleanOptionalText(body.description),
                            city: cleanOptionalText(body.city),
                            commissionRate: body.commissionRate,
                            active: body.active,
                            managerId: getAuthenticatedUserId(request),
                        },
                        include: storeInclude,
                    });

                    return reply.status(201).send(serializeStore(store));
                },
            );

            storeRoutes.patch(
                "/:storeId",
                {
                    preHandler: [app.authorize(["gestor", "master"])],
                    schema: updateStoreSchema,
                },
                async (request, reply) => {
                    const { storeId } = request.params as StoreParams;
                    const body = request.body as UpdateStoreBody;
                    const store = await ensureCanManageStore(
                        request,
                        reply,
                        storeId,
                    );

                    if (!store) {
                        return;
                    }

                    const data: Prisma.StoreUpdateInput = {};

                    if (body.name !== undefined) {
                        const name = cleanText(body.name);

                        if (!name) {
                            return reply
                                .status(400)
                                .send({ error: "Nome da loja é obrigatório" });
                        }

                        data.name = name;
                    }

                    if (body.description !== undefined) {
                        data.description = cleanOptionalText(body.description);
                    }

                    if (body.city !== undefined) {
                        data.city = cleanOptionalText(body.city);
                    }

                    if (body.commissionRate !== undefined) {
                        data.commissionRate = body.commissionRate;
                    }

                    if (body.active !== undefined) {
                        data.active = body.active;
                    }

                    const updatedStore = await prisma.store.update({
                        where: { id: store.id },
                        data,
                        include: storeInclude,
                    });

                    return serializeStore(updatedStore);
                },
            );

            storeRoutes.post(
                "/:storeId/sellers",
                {
                    preHandler: [app.authorize(["gestor", "master"])],
                    schema: addSellerSchema,
                },
                async (request, reply) => {
                    const { storeId } = request.params as StoreParams;
                    const { sellerId } = request.body as AddSellerBody;
                    const store = await ensureCanManageStore(
                        request,
                        reply,
                        storeId,
                    );

                    if (!store) {
                        return;
                    }

                    const seller = await prisma.user.findUnique({
                        where: { id: sellerId },
                        select: publicUserSelect,
                    });

                    if (!seller) {
                        return reply
                            .status(404)
                            .send({ error: "Vendedor não encontrado" });
                    }

                    if (seller.role !== "vendedor") {
                        return reply.status(400).send({
                            error: "Usuário informado não tem role vendedor",
                        });
                    }

                    const existingLink = await prisma.storeSeller.findUnique({
                        where: {
                            storeId_sellerId: {
                                storeId,
                                sellerId,
                            },
                        },
                    });

                    if (existingLink) {
                        return reply
                            .status(409)
                            .send({ error: "Vendedor já está vinculado" });
                    }

                    await prisma.storeSeller.create({
                        data: {
                            storeId,
                            sellerId,
                        },
                    });

                    const updatedStore = await prisma.store.findUniqueOrThrow({
                        where: { id: storeId },
                        include: storeInclude,
                    });

                    return reply.status(201).send(serializeStore(updatedStore));
                },
            );

            storeRoutes.delete(
                "/:storeId/sellers/:sellerId",
                {
                    preHandler: [app.authorize(["gestor", "master"])],
                    schema: removeSellerSchema,
                },
                async (request, reply) => {
                    const { storeId, sellerId } =
                        request.params as StoreSellerParams;
                    const store = await ensureCanManageStore(
                        request,
                        reply,
                        storeId,
                    );

                    if (!store) {
                        return;
                    }

                    const result = await prisma.storeSeller.deleteMany({
                        where: {
                            storeId,
                            sellerId,
                        },
                    });

                    if (result.count === 0) {
                        return reply.status(404).send({
                            error: "Vendedor não estava vinculado a esta loja",
                        });
                    }

                    return { message: "Vendedor removido da loja" };
                },
            );
        },
        { prefix: "/stores" },
    );
}
