import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const productStoreSelect = {
    id: true,
    name: true,
    city: true,
    active: true,
    managerId: true,
    sellers: {
        select: {
            sellerId: true,
        },
    },
} satisfies Prisma.StoreSelect;

const productInclude = {
    store: {
        select: productStoreSelect,
    },
} satisfies Prisma.ProductInclude;

type ProductWithStore = Prisma.ProductGetPayload<{
    include: typeof productInclude;
}>;

type ProductStore = Prisma.StoreGetPayload<{
    select: typeof productStoreSelect;
}>;

type DataResult<T> = { ok: true; data: T } | { ok: false; error: string };

type StoreParams = {
    storeId: string;
};

type ProductParams = {
    productId: string;
};

type ProductListQuery = {
    storeId?: string;
};

type CreateProductBody = {
    name: string;
    description?: string | null;
    sku?: string | null;
    quantity?: number;
    location?: string | null;
};

type UpdateProductBody = Partial<CreateProductBody>;

const storeProductParamsSchema = {
    params: {
        type: "object",
        required: ["storeId"],
        properties: {
            storeId: { type: "string", minLength: 1 },
        },
    },
};

const productParamsSchema = {
    params: {
        type: "object",
        required: ["productId"],
        properties: {
            productId: { type: "string", minLength: 1 },
        },
    },
};

const listProductsSchema = {
    querystring: {
        type: "object",
        properties: {
            storeId: { type: "string", minLength: 1 },
        },
    },
};

const createProductSchema = {
    ...storeProductParamsSchema,
    body: {
        type: "object",
        required: ["name"],
        properties: {
            name: { type: "string", minLength: 1 },
            description: { type: ["string", "null"] },
            sku: { type: ["string", "null"] },
            quantity: { type: "integer", minimum: 0 },
            location: { type: ["string", "null"] },
        },
    },
};

const updateProductSchema = {
    ...productParamsSchema,
    body: {
        type: "object",
        minProperties: 1,
        properties: {
            name: { type: "string", minLength: 1 },
            description: { type: ["string", "null"] },
            sku: { type: ["string", "null"] },
            quantity: { type: "integer", minimum: 0 },
            location: { type: ["string", "null"] },
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

function getAuthenticatedUserId(request: FastifyRequest) {
    return request.user.id ?? request.user.sub;
}

function canViewStore(request: FastifyRequest, store: ProductStore) {
    const userId = getAuthenticatedUserId(request);

    if (request.user.role === "master" || store.managerId === userId) {
        return true;
    }

    return store.sellers.some((seller) => seller.sellerId === userId);
}

function canViewProduct(request: FastifyRequest, product: ProductWithStore) {
    return canViewStore(request, product.store);
}

function buildVisibleStoreWhere(request: FastifyRequest): Prisma.StoreWhereInput {
    const userId = getAuthenticatedUserId(request);

    if (request.user.role === "master") {
        return {};
    }

    if (request.user.role === "gestor") {
        return { managerId: userId };
    }

    return {
        sellers: {
            some: { sellerId: userId },
        },
    };
}

function serializeProduct(product: ProductWithStore) {
    return {
        id: product.id,
        name: product.name,
        description: product.description,
        sku: product.sku,
        quantity: product.quantity,
        location: product.location,
        store: {
            id: product.store.id,
            name: product.store.name,
            city: product.store.city,
            active: product.store.active,
        },
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
    };
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

async function ensureCanManageProduct(
    request: FastifyRequest,
    reply: FastifyReply,
    productId: string,
) {
    const product = await prisma.product.findUnique({
        where: { id: productId },
        include: productInclude,
    });

    if (!product) {
        reply.status(404).send({ error: "Produto não encontrado" });
        return null;
    }

    if (
        request.user.role !== "master" &&
        product.store.managerId !== getAuthenticatedUserId(request)
    ) {
        reply
            .status(403)
            .send({ error: "Você não pode gerenciar este produto" });
        return null;
    }

    return product;
}

function buildCreateProductData(
    body: CreateProductBody,
): DataResult<Prisma.ProductCreateWithoutStoreInput> {
    const name = cleanText(body.name);

    if (!name) {
        return { ok: false, error: "Nome do produto é obrigatório" };
    }

    return {
        ok: true,
        data: {
            name,
            description: cleanOptionalText(body.description),
            sku: cleanOptionalText(body.sku),
            quantity: body.quantity ?? 0,
            location: cleanOptionalText(body.location),
        },
    };
}

function buildUpdateProductData(
    body: UpdateProductBody,
): DataResult<Prisma.ProductUpdateInput> {
    const data: Prisma.ProductUpdateInput = {};

    if (body.name !== undefined) {
        const name = cleanText(body.name);

        if (!name) {
            return { ok: false, error: "Nome do produto é obrigatório" };
        }

        data.name = name;
    }

    if (body.description !== undefined) {
        data.description = cleanOptionalText(body.description);
    }

    if (body.sku !== undefined) {
        data.sku = cleanOptionalText(body.sku);
    }

    if (body.quantity !== undefined) {
        data.quantity = body.quantity;
    }

    if (body.location !== undefined) {
        data.location = cleanOptionalText(body.location);
    }

    return { ok: true, data };
}

export function registerProductRoutes(app: FastifyInstance) {
    app.register(
        async (productRoutes) => {
            productRoutes.get(
                "/",
                {
                    preHandler: [app.authenticate],
                    schema: listProductsSchema,
                },
                async (request) => {
                    const query = request.query as ProductListQuery;
                    const visibleStoreWhere = buildVisibleStoreWhere(request);
                    const where: Prisma.ProductWhereInput = {
                        store: query.storeId
                            ? { ...visibleStoreWhere, id: query.storeId }
                            : visibleStoreWhere,
                    };

                    const products = await prisma.product.findMany({
                        where,
                        include: productInclude,
                        orderBy: { createdAt: "desc" },
                    });

                    return products.map(serializeProduct);
                },
            );

            productRoutes.get(
                "/:productId",
                {
                    preHandler: [app.authenticate],
                    schema: productParamsSchema,
                },
                async (request, reply) => {
                    const { productId } = request.params as ProductParams;
                    const product = await prisma.product.findUnique({
                        where: { id: productId },
                        include: productInclude,
                    });

                    if (!product) {
                        return reply
                            .status(404)
                            .send({ error: "Produto não encontrado" });
                    }

                    if (!canViewProduct(request, product)) {
                        return reply.status(403).send({
                            error: "Você não pode visualizar este produto",
                        });
                    }

                    return serializeProduct(product);
                },
            );

            productRoutes.patch(
                "/:productId",
                {
                    preHandler: [app.authorize(["gestor", "master"])],
                    schema: updateProductSchema,
                },
                async (request, reply) => {
                    const { productId } = request.params as ProductParams;
                    const product = await ensureCanManageProduct(
                        request,
                        reply,
                        productId,
                    );

                    if (!product) {
                        return;
                    }

                    const result = buildUpdateProductData(
                        request.body as UpdateProductBody,
                    );

                    if (!result.ok) {
                        return reply.status(400).send({ error: result.error });
                    }

                    const updatedProduct = await prisma.product.update({
                        where: { id: product.id },
                        data: result.data,
                        include: productInclude,
                    });

                    return serializeProduct(updatedProduct);
                },
            );

            productRoutes.delete(
                "/:productId",
                {
                    preHandler: [app.authorize(["gestor", "master"])],
                    schema: productParamsSchema,
                },
                async (request, reply) => {
                    const { productId } = request.params as ProductParams;
                    const product = await ensureCanManageProduct(
                        request,
                        reply,
                        productId,
                    );

                    if (!product) {
                        return;
                    }

                    await prisma.product.delete({
                        where: { id: product.id },
                    });

                    return { message: "Produto removido do estoque" };
                },
            );
        },
        { prefix: "/products" },
    );

    app.register(
        async (storeProductRoutes) => {
            storeProductRoutes.get(
                "/:storeId/products",
                {
                    preHandler: [app.authenticate],
                    schema: storeProductParamsSchema,
                },
                async (request, reply) => {
                    const { storeId } = request.params as StoreParams;
                    const store = await prisma.store.findUnique({
                        where: { id: storeId },
                        select: productStoreSelect,
                    });

                    if (!store) {
                        return reply
                            .status(404)
                            .send({ error: "Loja não encontrada" });
                    }

                    if (!canViewStore(request, store)) {
                        return reply.status(403).send({
                            error: "Você não pode visualizar os produtos desta loja",
                        });
                    }

                    const products = await prisma.product.findMany({
                        where: { storeId },
                        include: productInclude,
                        orderBy: { createdAt: "desc" },
                    });

                    return products.map(serializeProduct);
                },
            );

            storeProductRoutes.post(
                "/:storeId/products",
                {
                    preHandler: [app.authorize(["gestor", "master"])],
                    schema: createProductSchema,
                },
                async (request, reply) => {
                    const { storeId } = request.params as StoreParams;
                    const store = await ensureCanManageStore(
                        request,
                        reply,
                        storeId,
                    );

                    if (!store) {
                        return;
                    }

                    const result = buildCreateProductData(
                        request.body as CreateProductBody,
                    );

                    if (!result.ok) {
                        return reply.status(400).send({ error: result.error });
                    }

                    const product = await prisma.product.create({
                        data: {
                            ...result.data,
                            store: {
                                connect: { id: store.id },
                            },
                        },
                        include: productInclude,
                    });

                    return reply.status(201).send(serializeProduct(product));
                },
            );
        },
        { prefix: "/stores" },
    );
}
