package com.xwiggy.food.controller;
import com.xwiggy.food.dao.UserService;
import com.xwiggy.food.model.LoginResponse;
import com.xwiggy.food.model.User;
import com.xwiggy.food.security.JwtUtil;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class RegistrationController {

    @Autowired
    private UserService userDao;

    @Autowired
    private JwtUtil jwtUtil;

    @RequestMapping("/api/register")
    public User showRegister() {
        return new User();
    }

    @PostMapping("/register")
    public ResponseEntity<?> addUser(@RequestBody User user) {
        try {
            userDao.register(user);
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(e.getMessage());
        }
        user.setPassword(null);
        String role = user.isMerchant() ? "MERCHANT" : "USER";
        String token = jwtUtil.generateToken(user.getUsername(), role);
        return ResponseEntity.ok(new LoginResponse(token, user));
    }

    @PostMapping("/checkUserName")
    public boolean checkAvailability(@RequestBody String username){
        return userDao.usernameExists(username);
    }
}
