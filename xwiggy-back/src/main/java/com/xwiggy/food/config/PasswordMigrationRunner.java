package com.xwiggy.food.config;

import com.xwiggy.food.dao.UserDao;
import com.xwiggy.food.model.User;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.regex.Pattern;

/**
 * One-time (per-row), idempotent migration: any user whose stored password is not already a
 * BCrypt hash gets it hashed in place on startup. This lets existing plaintext seed data
 * (e.g. the demo user/merchant accounts from the SQL dump) keep working once password
 * hashing is introduced, without a manual DB migration step.
 */
@Component
public class PasswordMigrationRunner implements CommandLineRunner {

    private static final Pattern BCRYPT_PATTERN = Pattern.compile("^\\$2[aby]\\$\\d{2}\\$.{53}$");

    @Autowired
    private UserDao userDao;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Override
    public void run(String... args) {
        List<User> users = userDao.findAll();
        for (User user : users) {
            if (user.getPassword() != null && !BCRYPT_PATTERN.matcher(user.getPassword()).matches()) {
                user.setPassword(passwordEncoder.encode(user.getPassword()));
                userDao.save(user);
            }
        }
    }
}
