import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma";

type Role = "vendedor" | "gestor" | "master";
const defaultPasswordResetTokenTtlMinutes = 30;
const passwordResetSuccessMessage =
    "Se o e-mail estiver cadastrado, enviaremos instruções para redefinir a senha.";

declare module "@fastify/jwt" {
    interface FastifyJWT {
        payload: { sub: string; id: string; email: string; role: Role };
        user: { sub: string; id: string; email: string; role: Role };
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

const forgotPasswordSchema = {
    body: {
        type: "object",
        required: ["email"],
        properties: {
            email: { type: "string", format: "email" },
        },
    },
};

const resetPasswordSchema = {
    body: {
        type: "object",
        required: ["token", "newPassword"],
        properties: {
            token: { type: "string", minLength: 64 },
            newPassword: { type: "string", minLength: 6 },
        },
    },
};

function hashPasswordResetToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
}

function getPasswordResetTokenTtlMinutes() {
    const passwordResetTokenTtlMinutes = Number(
        process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES,
    );

    if (
        Number.isFinite(passwordResetTokenTtlMinutes) &&
        passwordResetTokenTtlMinutes > 0
    ) {
        return passwordResetTokenTtlMinutes;
    }

    return defaultPasswordResetTokenTtlMinutes;
}

function getPasswordResetExpiresAt() {
    return new Date(Date.now() + getPasswordResetTokenTtlMinutes() * 60 * 1000);
}

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
                    const normalizedEmail = normalizeEmail(email);

                    const existingUser = await prisma.user.findUnique({
                        where: { email: normalizedEmail },
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
                            email: normalizedEmail,
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
        const normalizedEmail = normalizeEmail(email);
        const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
        });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return reply.status(401).send({ error: "Credenciais inválidas" });
        }

        const token = app.jwt.sign(
            {
                sub: user.id,
                id: user.id,
                email: user.email,
                role: user.role as Role,
            },
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

    app.post(
        "/forgot-password",
        { schema: forgotPasswordSchema },
        async (request) => {
            const { email } = request.body as { email: string };
            const normalizedEmail = normalizeEmail(email);
            const user = await prisma.user.findUnique({
                where: { email: normalizedEmail },
            });

            if (!user) {
                return { message: passwordResetSuccessMessage };
            }

            const resetToken = randomBytes(32).toString("hex");
            const expiresAt = getPasswordResetExpiresAt();

            await prisma.$transaction([
                prisma.passwordResetToken.deleteMany({
                    where: { userId: user.id },
                }),
                prisma.passwordResetToken.create({
                    data: {
                        userId: user.id,
                        tokenHash: hashPasswordResetToken(resetToken),
                        expiresAt,
                    },
                }),
            ]);

            if (process.env.NODE_ENV === "production") {
                app.log.info(
                    { userId: user.id },
                    "Token de recuperação de senha gerado",
                );

                return { message: passwordResetSuccessMessage };
            }

            return {
                message: passwordResetSuccessMessage,
                resetToken,
                expiresAt,
            };
        },
    );

    app.post(
        "/reset-password",
        { schema: resetPasswordSchema },
        async (request, reply) => {
            const { token, newPassword } = request.body as {
                token: string;
                newPassword: string;
            };
            const tokenHash = hashPasswordResetToken(token.trim());
            const passwordResetToken =
                await prisma.passwordResetToken.findUnique({
                    where: { tokenHash },
                });

            if (
                !passwordResetToken ||
                passwordResetToken.expiresAt.getTime() < Date.now()
            ) {
                return reply
                    .status(400)
                    .send({ error: "Token inválido ou expirado" });
            }

            const hashedPassword = await bcrypt.hash(newPassword, 10);

            await prisma.$transaction([
                prisma.user.update({
                    where: { id: passwordResetToken.userId },
                    data: { password: hashedPassword },
                }),
                prisma.passwordResetToken.deleteMany({
                    where: { userId: passwordResetToken.userId },
                }),
            ]);

            return reply.send({ message: "Senha redefinida com sucesso" });
        },
    );
}
