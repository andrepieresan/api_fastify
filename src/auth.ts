import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import * as bcrypt from "bcryptjs";
import { prisma } from "./prisma";

type Role = "vendedor" | "gestor" | "master";

declare module "@fastify/jwt" {
    interface FastifyJWT {
        payload: { sub: string; email: string; role: Role };
        user: { id: string; email: string; role: Role };
    }
}

declare module "fastify" {
    interface FastifyInstance {
        authenticate: (
            request: FastifyRequest,
            reply: FastifyReply,
        ) => Promise<unknown>;
        authorize: (
            roles: Role[],
        ) => (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    }
}

const createUserSchema = {
    body: {
        type: "object",
        required: ["name", "email", "password", "role"],
        properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 6 },
            role: { type: "string", enum: ["vendedor", "gestor", "master"] },
        },
    },
};

const loginSchema = {
    body: {
        type: "object",
        required: ["email", "password"],
        properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
        },
    },
};

export function registerAuthRoutes(app: FastifyInstance) {
    app.register(fastifyJwt, {
        secret: process.env.JWT_SECRET ?? "change_this_in_production",
    });

    app.decorate("authenticate", async (request, reply) => {
        try {
            await request.jwtVerify();
        } catch (err) {
            return reply
                .status(401)
                .send({ error: "Token inválido ou ausente" });
        }
    });

    app.decorate("authorize", (allowedRoles: Role[]) => {
        return async (request, reply) => {
            try {
                await request.jwtVerify();
            } catch (err) {
                return reply
                    .status(401)
                    .send({ error: "Token inválido ou ausente" });
            }

            if (!allowedRoles.includes(request.user.role)) {
                return reply
                    .status(403)
                    .send({ error: "Acesso negado: permissão insuficiente" });
            }
        };
    });

    app.register(
        async (userRoutes) => {
            userRoutes.get(
                "/me",
                { preHandler: [app.authenticate] },
                async (request) => {
                    return { user: request.user };
                },
            );

            userRoutes.post(
                "/store",
                { schema: createUserSchema },
                async (request, reply) => {
                    const { name, email, password, role } = request.body as {
                        name: string;
                        email: string;
                        password: string;
                        role: Role;
                    };

                    const existingUser = await prisma.user.findUnique({
                        where: { email },
                    });
                    if (existingUser) {
                        return reply
                            .status(409)
                            .send({ error: "E-mail já cadastrado" });
                    }

                    const hashedPassword = await bcrypt.hash(password, 10);
                    const user = await prisma.user.create({
                        data: {
                            name,
                            email,
                            password: hashedPassword,
                            role,
                        },
                    });

                    return reply.status(201).send({
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        role: user.role,
                    });
                },
            );
        },
        { prefix: "/user" },
    );

    app.get(
        "/users",
        { preHandler: [app.authorize(["gestor", "master"])] },
        async () => {
            const users = await prisma.user.findMany({
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });

            return users;
        },
    );

    app.post("/login", { schema: loginSchema }, async (request, reply) => {
        const { email, password } = request.body as {
            email: string;
            password: string;
        };
        const user = await prisma.user.findUnique({ where: { email } });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return reply.status(401).send({ error: "Credenciais inválidas" });
        }

        const token = app.jwt.sign(
            { sub: user.id, email: user.email, role: user.role as Role },
            { expiresIn: "1h" },
        );

        return reply.send({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
            },
        });
    });
}
