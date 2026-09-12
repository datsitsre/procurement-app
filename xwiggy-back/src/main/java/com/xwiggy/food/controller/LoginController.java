package com.xwiggy.food.controller;

import com.xwiggy.food.dao.UserService;
import com.xwiggy.food.model.Login;
import com.xwiggy.food.model.LoginResponse;
import com.xwiggy.food.model.User;
import com.xwiggy.food.security.JwtUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class LoginController {

    @Autowired
    private UserService userDao;

    @Autowired
    private JwtUtil jwtUtil;


    @RequestMapping("/login")
    public Login showLogin() {
        return new Login();
    }

    @PostMapping("/login")
    public ResponseEntity<LoginResponse> loginProcess(@RequestBody Login login) {
        User user = userDao.validateUser(login);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        user.setPassword(null);
        String role = user.isMerchant() ? "MERCHANT" : "USER";
        String token = jwtUtil.generateToken(user.getUsername(), role);
        return ResponseEntity.ok(new LoginResponse(token, user));
    }

}
