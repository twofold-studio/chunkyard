import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

// A test console, not Minecraft. Exercises the real JVM under container limits.
public final class ConsoleServer {
    public static void main(String[] args) throws Exception {
        Files.writeString(Path.of("starts.txt"), "fixture started\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        System.out.println("Done (0.1s)! For help, type \"help\"");
        var reader = new BufferedReader(new InputStreamReader(System.in));
        String line;
        while ((line = reader.readLine()) != null) {
            if (line.equals("stop")) {
                System.out.println("Stopping server");
                return;
            }
            Files.writeString(Path.of("last-command.txt"), line + "\n");
            System.out.println("command: " + line);
        }
    }
}
