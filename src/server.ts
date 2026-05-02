import "dotenv/config";
import Fastify, { FastifyInstance } from "fastify";
import { registerAuthRoutes } from "./auth";
import { loggerOptions } from "./logger";
import { prisma } from "./prisma";

const app: FastifyInstance = Fastify({ logger: loggerOptions });

app.addHook("onClose", async () => {
    await prisma.$disconnect();
});

registerAuthRoutes(app);

app.get("/", () => {
    return { message: "Bem-vindo à API DA GALERA!" };
});

app.get("/check", async () => {
    return { status: "online" };
});

const start = async () => {
    const port = Number(process.env.PORT ?? 3333);

    try {
        await app.listen({ port, host: "0.0.0.0" });
        app.log.info(`Servidor rodando em http://localhost:${port}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
