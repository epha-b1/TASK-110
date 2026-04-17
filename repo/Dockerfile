FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json jest.config.js .sequelizerc ./
COPY src/        ./src/
COPY migrations/ ./migrations/
COPY seeders/    ./seeders/
COPY unit_tests/ ./unit_tests/
COPY API_tests/  ./API_tests/

RUN npm run build
RUN mkdir -p uploads exports face-templates var/import-tmp

EXPOSE 3000
CMD ["node", "dist/server.js"]
