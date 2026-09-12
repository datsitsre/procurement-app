package com.xwiggy.food.dao;

import com.xwiggy.food.model.Login;
import com.xwiggy.food.model.User;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class UserService{

    @Autowired
    private UserDao userDao;

    @Autowired
    private PasswordEncoder passwordEncoder;


    public void register(User user) {
        // username is the @Id - without this check, save() on an existing username is an
        // UPDATE, silently overwriting that account's password/profile with the request's.
        if (userDao.existsById(user.getUsername())) {
            throw new IllegalStateException("Username is already taken");
        }
        user.setPassword(passwordEncoder.encode(user.getPassword()));
        userDao.save(user);
    }

    public User validateUser(Login login) {
        return userDao.findById(login.getUsername())
                .filter(candidate -> passwordEncoder.matches(login.getPassword(), candidate.getPassword()))
                .orElse(null);
    }

    public Boolean usernameExists(String username){
       return userDao.findById(username).isPresent();
    }

}
