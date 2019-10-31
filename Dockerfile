FROM node:10.16.3 AS build
MAINTAINER Jason McLaurin

WORKDIR /usr/app

ARG NPM_TOKEN

# Project uses private NPM modules. Pass in NPM token externally.
# Tell NPM to use the token from the environment variable
RUN echo "registry=https://registry.npmjs.org/" > /usr/app/.npmrc
RUN echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" >> /usr/app/.npmrc
RUN echo 'registry "https://registry.npmjs.org"' > /usr/app/.yarnrc

COPY package.json yarn.lock /usr/app/
RUN yarn --production --frozen-lockfile || \
    (cat yarn-error.log; exit 1)

FROM node:10.16.3

WORKDIR /usr/app

ARG NODE_ENV=production

ENV NODE_ENV=$NODE_ENV

COPY package.json yarn.lock /usr/app/
COPY lib/ /usr/app/lib
COPY --from=build /usr/app/node_modules /usr/app/node_modules

CMD ["node", "lib/index.js"]
