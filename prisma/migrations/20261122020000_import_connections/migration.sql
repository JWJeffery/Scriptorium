-- Signed-in cloud storage connections (Box) used to add books; tokens stay on the server.
CREATE TABLE "ImportConnection" (
    "provider" VARCHAR(32) NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "account" VARCHAR(255),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ImportConnection_pkey" PRIMARY KEY ("provider")
);
