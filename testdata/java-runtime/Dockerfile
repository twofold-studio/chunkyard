FROM eclipse-temurin:21-jdk AS build
WORKDIR /build
COPY ConsoleServer.java .
RUN javac ConsoleServer.java && jar --create --file fixture.jar --main-class ConsoleServer ConsoleServer.class
FROM eclipse-temurin:21-jre
COPY --from=build /build/fixture.jar /fixture.jar
